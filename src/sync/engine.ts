import { db, CLIENT_WRITABLE_TABLES, type SyncedTable } from '@/lib/db';
import { getSupabase } from '@/lib/supabase';
import { domainToRow, rowToDomain } from '@/repositories/rowMapping';
import { onLocalWrite } from '@/repositories/local';
import { syncStatus } from './status';

/**
 * Offline-first sync:
 * - push: drain the outbox (current Dexie row state, so edits coalesce) as
 *   upserts; server rejections stay queued and visible rather than vanishing
 * - pull: per-table delta on updated_at > cursor (server-authoritative
 *   timestamps); rows with a pending local edit are skipped (local wins until
 *   its push lands, then the next pull settles it — last-write-wins)
 * - triggers: local writes, connectivity changes, Supabase realtime events,
 *   and a slow fallback interval
 */

const SYNC_TABLES: SyncedTable[] = [
  'clinics',
  'therapists',
  'service_catalog',
  'patients',
  'visits',
  'invoices',
  'invoice_payments',
  'payments',
  'settlements',
  'consultation_notes',
];
// ai_generation_log is deliberately excluded — online-only, per the clinical
// docs handoff. It never appears here, in CLIENT_WRITABLE_TABLES, or in the
// Dexie schema.

const EPOCH = '1970-01-01T00:00:00+00:00';
const PAGE = 1000;

// numeric(5,2) columns can arrive as strings depending on the PostgREST
// version — force them back to numbers on the way in.
const NUMERIC_FIELDS: Partial<Record<SyncedTable, string[]>> = {
  clinics: ['bmSplitPct', 'taxPct', 'fyStartMonth'],
  visits: ['bmSplitPct', 'taxPct', 'sharedPct'],
};

function normalize(table: SyncedTable, obj: Record<string, unknown>) {
  for (const f of NUMERIC_FIELDS[table] ?? []) {
    if (obj[f] != null) obj[f] = Number(obj[f]);
  }
  return obj;
}

export class SyncEngine {
  private supabase = getSupabase();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private rerunRequested = false;
  private started = false;

  start() {
    if (this.started || !this.supabase) return;
    this.started = true;

    onLocalWrite(() => {
      void this.updatePending();
      this.schedule();
    });

    window.addEventListener('online', () => {
      syncStatus.set({ online: true });
      this.schedule();
    });
    window.addEventListener('offline', () => syncStatus.set({ online: false }));

    const channel = this.supabase.channel('thera-net-sync');
    for (const table of SYNC_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () =>
        this.schedule()
      );
    }
    channel.subscribe();

    // Fallback poll in case a realtime event is missed
    setInterval(() => this.schedule(), 5 * 60 * 1000);

    void this.updatePending();
    this.schedule();
  }

  /** Debounced full sync (push then pull). */
  schedule(delayMs = 300) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.sync(), delayMs);
  }

  async sync(): Promise<void> {
    if (!this.supabase || !navigator.onLine) return;
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    const {
      data: { session },
    } = await this.supabase.auth.getSession();
    if (!session) return;

    this.running = true;
    syncStatus.set({ syncing: true });
    try {
      await this.push();
      await this.pull();
      syncStatus.set({ lastSyncAt: Date.now(), error: null });
    } catch (e) {
      syncStatus.set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      await this.updatePending();
      syncStatus.set({ syncing: false });
      this.running = false;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        this.schedule();
      }
    }
  }

  private async updatePending() {
    syncStatus.set({ pending: await db.outbox.count() });
  }

  /**
   * Stop retrying a permanently-failed local change (e.g. it keeps getting
   * rejected by a server-side rule). The local row is untouched — only the
   * queued sync attempt is dropped, so this device's copy will keep
   * differing from the server for that row until it's edited again.
   */
  async discard(table: SyncedTable, rowId: string): Promise<void> {
    await db.outbox.where('table').equals(table).and((e) => e.rowId === rowId).delete();
    await this.updatePending();
  }

  private async push() {
    const supabase = this.supabase!;
    const entries = await db.outbox.orderBy('seq').toArray();
    if (!entries.length) return;

    // One push per row: the outbox stores ids, not payloads, so N edits to a
    // row collapse into a single upsert of its current state.
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = `${entry.table}:${entry.rowId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (!(CLIENT_WRITABLE_TABLES as readonly string[]).includes(entry.table)) {
        await db.outbox.where('seq').belowOrEqual(entry.seq!).and((e) => e.table === entry.table && e.rowId === entry.rowId).delete();
        continue;
      }

      const row = await db.table(entry.table).get(entry.rowId);
      const maxSeq = Math.max(
        ...entries.filter((e) => e.table === entry.table && e.rowId === entry.rowId).map((e) => e.seq!)
      );
      if (!row) {
        await this.clearOutbox(entry.table, entry.rowId, maxSeq);
        continue;
      }

      const { error } = await supabase.from(entry.table).upsert(domainToRow(row));
      if (error) {
        // Network-level failures throw to stop the drain; server rejections
        // (RLS, constraints, immutability triggers) stay queued and visible.
        if (error.message.toLowerCase().includes('fetch')) throw new Error('Network unreachable');
        await db.outbox
          .where('seq')
          .equals(entry.seq!)
          .modify({ error: error.message });
        continue;
      }
      await this.clearOutbox(entry.table, entry.rowId, maxSeq);
    }
  }

  private async clearOutbox(table: SyncedTable, rowId: string, upToSeq: number) {
    await db.outbox
      .where('table')
      .equals(table)
      .and((e) => e.rowId === rowId && e.seq! <= upToSeq)
      .delete();
  }

  private async pull() {
    const supabase = this.supabase!;
    for (const table of SYNC_TABLES) {
      let cursor = (await db.meta.get(`cursor:${table}`))?.value ?? EPOCH;
      for (;;) {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .gt('updated_at', cursor)
          .order('updated_at', { ascending: true })
          .limit(PAGE);
        if (error) throw new Error(`pull ${table}: ${error.message}`);
        if (!data?.length) break;

        const pendingIds = new Set(
          (await db.outbox.where('table').equals(table).toArray()).map((e) => e.rowId)
        );
        const incoming = data
          .map((row) => normalize(table, rowToDomain<Record<string, unknown>>(row)))
          .filter((obj) => !pendingIds.has(obj.id as string));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.table(table).bulkPut(incoming as any[]);

        cursor = (data[data.length - 1] as { updated_at: string }).updated_at;
        await db.meta.put({ key: `cursor:${table}`, value: cursor });
        if (data.length < PAGE) break;
      }
    }
  }
}

export const syncEngine = new SyncEngine();
