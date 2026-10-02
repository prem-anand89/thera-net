import { isPermanentLinkError, listPendingLinks, removePendingLink } from './pendingLinks';
import { db, ALL_SYNCED_TABLES, CLIENT_WRITABLE_TABLES, type SyncedTable } from '@/lib/db';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { domainToRow, rowToDomain } from '@/repositories/rowMapping';
import { onLocalWrite } from '@/repositories/local';
import { syncStatus, isPermanentFailure } from './status';
import { coerceReferringSource } from '@/domain/types';

/** Shown (and matched by toFriendlyMessage) when the server can't be reached. */
export const NETWORK_UNREACHABLE = 'Network unreachable';
const RETRY_MIN_MS = 15_000;
const RETRY_MAX_MS = 120_000;

/** fetch() failures across browsers: Chrome "Failed to fetch", Safari "Load failed", Firefox "NetworkError…". */
export function isFetchFailure(message: string): boolean {
  return /failed to fetch|load failed|networkerror|network request failed|network unreachable/i.test(message);
}

/**
 * Offline-first sync:
 * - push: drain the outbox (current Dexie row state, so edits coalesce) as
 *   upserts; server rejections stay queued and visible rather than vanishing
 * - pull: per-table delta on updated_at > cursor (server-authoritative
 *   timestamps); rows with a pending local edit are skipped (local wins until
 *   its push lands, then the next pull settles it — last-write-wins)
 * - a permanently-rejected push (RLS) is the one exception to "local wins
 *   until the push lands": it never will, so the row is fetched fresh and
 *   overwritten immediately rather than left showing a rejected edit
 *   indefinitely — see push()'s error branch
 * - triggers: local writes, connectivity changes, Supabase realtime events,
 *   and a slow fallback interval
 */

const SYNC_TABLES: readonly SyncedTable[] = ALL_SYNCED_TABLES;
// ai_generation_log is deliberately excluded — online-only, per the clinical
// docs handoff. It never appears here, in CLIENT_WRITABLE_TABLES, or in the
// Dexie schema.

const EPOCH = '1970-01-01T00:00:00+00:00';
const PAGE = 1000;

// numeric(5,2) columns can arrive as strings depending on the PostgREST
// version — force them back to numbers on the way in.
const NUMERIC_FIELDS: Partial<Record<SyncedTable, string[]>> = {
  clinics: ['clinicSplitPct', 'taxPct', 'fyStartMonth'],
  visits: ['clinicSplitPct', 'taxPct', 'sharedPct'],
  // psfs_mean is numeric(3,1), same family as the columns above that
  // PostgREST can hand back as a string.
  consultation_notes: ['psfsMean'],
};

function normalize(table: SyncedTable, obj: Record<string, unknown>) {
  for (const f of NUMERIC_FIELDS[table] ?? []) {
    if (obj[f] != null) obj[f] = Number(obj[f]);
  }
  return obj;
}

/**
 * Validates that a normalized row is safe to store. Ensures all required
 * fields are present and have correct types — catches schema mismatches
 * early instead of silently corrupting data.
 */
function validateNormalizedRow(table: SyncedTable, row: Record<string, unknown>): boolean {
  // Domain objects are camelCase after rowToDomain — do not look for
  // Postgres snake_case here or every pulled row is skipped and a first
  // login looks like "create your clinic".
  if (typeof row.id !== 'string' || !row.id) {
    console.error(`[Sync] ${table} row missing id:`, row);
    return false;
  }
  if (typeof row.updatedAt !== 'string' || !row.updatedAt) {
    console.error(`[Sync] ${table} row ${row.id} missing updatedAt:`, row);
    return false;
  }
  return true;
}

/** True if `nowIds` contains a clinic id not present in `knownIds` —
 *  pulled out of `reconcileClinicMembership` so this one comparison
 *  (the whole reason the reconciliation step exists) is directly testable
 *  without mocking Supabase or Dexie. */
export function clinicMembershipGrew(nowIds: string[], knownIds: string[]): boolean {
  return nowIds.some((id) => !knownIds.includes(id));
}

export class SyncEngine {
  private supabase = getSupabase();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private rerunRequested = false;
  private started = false;
  private channel: RealtimeChannel | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  
  private handleOnline = () => {
    syncStatus.set({ online: true });
    this.schedule();
  };

  private handleOffline = () => {
    syncStatus.set({ online: false });
  };

  // Phones suspend the PWA in the background; its first request on resume
  // often fails. Sync again as soon as it's visible.
  private handleVisible = () => {
    if (document.visibilityState === 'visible') this.schedule();
  };

  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = RETRY_MIN_MS;

  /** Back off 15s → 30s → … → 2 min after a network failure. */
  private scheduleRetry() {
    if (this.retryTimer) return;
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.schedule(0);
    }, delay);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.channel) {
      await this.supabase?.removeChannel(this.channel);
      this.channel = null;
    }
    
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
      document.removeEventListener('visibilitychange', this.handleVisible);
    }
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  start() {
    if (this.started || !this.supabase) return;
    this.started = true;

    onLocalWrite(() => {
      void this.updatePending();
      this.schedule();
    });

    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    document.addEventListener('visibilitychange', this.handleVisible);

    this.channel = this.supabase.channel('thera-net-sync');
    for (const table of SYNC_TABLES) {
      this.channel.on('postgres_changes', { event: '*', schema: 'public', table }, () =>
        this.schedule()
      );
    }
    this.channel.subscribe();

    // Fallback poll in case a realtime event is missed
    this.fallbackTimer = setInterval(() => this.schedule(), 5 * 60 * 1000);

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
      await this.reconcileClinicMembership(session.user.id);
      await this.push();
      const sentLinks = await this.flushAppointmentLinks();
      await this.pull();
      // Cleared only now: removing a link before the pull let the appointment
      // flash back to "not done" until the linked row arrived. If the pull
      // fails, the link stays queued and the next cycle's RPC answers "already
      // linked", which drops it.
      for (const appointmentId of sentLinks) await removePendingLink(appointmentId);
      syncStatus.set({ lastSyncAt: Date.now(), error: null });
      this.retryDelayMs = RETRY_MIN_MS;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      syncStatus.set({ error: isFetchFailure(message) ? NETWORK_UNREACHABLE : message });
      // Connection blips clear on their own — retry soon rather than waiting
      // for the 5-minute poll.
      if (isFetchFailure(message)) this.scheduleRetry();
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

  /**
   * Sends queued appointment → visit links (see pendingLinks.ts) once the
   * visit itself is on the server — the RPC's foreign key needs it there. A
   * visit still waiting in the outbox just means "next cycle"; a network
   * failure leaves the link queued; an error that can never succeed drops it.
   */
  private async flushAppointmentLinks(): Promise<string[]> {
    const sent: string[] = [];
    if (!this.started) return sent;
    const links = await listPendingLinks();
    for (const link of links) {
      const visitWaiting =
        (await db.outbox
          .where('table')
          .equals('visits')
          .and((e) => e.rowId === link.visitId)
          .count()) > 0;
      if (visitWaiting) continue;
      const { error } = await this.supabase!.rpc('link_appointment_visit', {
        p_appointment_id: link.appointmentId,
        p_visit_id: link.visitId,
        p_patient_id: link.patientId,
      });
      if (!error) {
        sent.push(link.appointmentId);
      } else if (isPermanentLinkError(error.message)) {
        console.error('Dropping an appointment link that can never apply', error.message);
        await removePendingLink(link.appointmentId);
      } else if (isFetchFailure(error.message)) {
        throw new Error(error.message);
      }
      // Anything else (e.g. a not-yet-synced row): keep it queued, retry next cycle.
    }
    return sent;
  }

  private async updatePending() {
    syncStatus.set({ pending: await db.outbox.count() });
  }

  /**
   * Every per-table pull cursor below only ever moves forward against
   * `updated_at`, so a clinic that becomes newly visible (a fresh invite,
   * or this device's own account creating a second clinic elsewhere) can
   * have rows — including its own `clinics` row — older than a cursor
   * this device already advanced while syncing its first clinic. Those
   * rows would then never come back from an incremental `.gt(cursor)`
   * pull. Detecting membership growth via this cheap, uncursored query
   * and resetting every cursor when it grows forces one full re-pull,
   * which is always safe since RLS still scopes exactly what returns.
   */
  private async reconcileClinicMembership(userId: string) {
    const supabase = this.supabase!;
    const { data, error } = await supabase
      .from('clinic_members')
      .select('clinic_id')
      .eq('user_id', userId);
    if (error) return; // best-effort — next sync cycle gets another chance
    const nowIds = (data ?? []).map((r) => r.clinic_id as string).sort();
    const knownRaw = (await db.meta.get('knownClinicIds'))?.value ?? '[]';
    let knownIds: string[];
    try {
      knownIds = JSON.parse(knownRaw);
    } catch {
      knownIds = [];
    }
    const grew = clinicMembershipGrew(nowIds, knownIds);
    if (grew) {
      await db.meta.where('key').startsWith('cursor:').delete();
    }
    await db.meta.put({ key: 'knownClinicIds', value: JSON.stringify(nowIds) });
  }

  /**
   * Stop retrying a permanently-failed local change (e.g. it keeps getting
   * rejected by a server-side rule). The local row is untouched — only the
   * queued sync attempt is dropped, so this device's copy will keep
   * differing from the server for that row until it's edited again.
   */
  async discard(table: SyncedTable, rowId: string): Promise<void> {
    await db.outbox
      .where('table')
      .equals(table)
      .and((e) => e.rowId === rowId)
      .delete();
    await this.updatePending();
  }

  private async push() {
    if (!this.started) return;
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
        await db.outbox
          .where('seq')
          .belowOrEqual(entry.seq!)
          .and((e) => e.table === entry.table && e.rowId === entry.rowId)
          .delete();
        continue;
      }

      const row = await db.table(entry.table).get(entry.rowId);
      const maxSeq = Math.max(
        ...entries
          .filter((e) => e.table === entry.table && e.rowId === entry.rowId)
          .map((e) => e.seq!)
      );
      if (!row) {
        await this.clearOutbox(entry.table, entry.rowId, maxSeq);
        continue;
      }

      // Older Edit Patient UI wrote referring_source values that fail the
      // DB check constraint. Rewrite in place (no extra outbox row) so a
      // stuck patients push can succeed on retry.
      if (entry.table === 'patients') {
        const referringSource = coerceReferringSource(
          (row as { referringSource?: string | null }).referringSource
        );
        if (referringSource !== (row as { referringSource?: string | null }).referringSource) {
          (row as { referringSource: string | null }).referringSource = referringSource;
          await db.patients.put(row);
        }
      }

      const payload = domainToRow(row);
      // Server-owned columns a full-row upsert must not carry: working hours
      // are written only by set_therapist_working_hours, and a stale local
      // copy (pending edit to the same row) would silently revert them.
      if (entry.table === 'therapists') delete payload.working_hours;
      const { error } = await supabase.from(entry.table).upsert(payload);
      if (error) {
        // Network-level failures throw to stop the drain; server rejections
        // (RLS, constraints, immutability triggers) stay queued and visible.
        if (isFetchFailure(error.message)) throw new Error(NETWORK_UNREACHABLE);
        await db.outbox
          .where('seq')
          .equals(entry.seq!)
          .modify({ error: error.message, errorCode: error.code });
        // An RLS rejection will never succeed by retrying — the row's
        // ownership isn't going to change on its own — so unlike every
        // other queued failure (which might genuinely clear on retry),
        // leaving the local row as-is would show this device's rejected
        // edit indefinitely: pull() deliberately skips any row with a
        // pending outbox entry, precisely so a still-retryable edit isn't
        // clobbered mid-flight, but that same skip means a permanently
        // failed one is never settled by a normal pull either. Revert this
        // one row to server truth immediately instead. The outbox entry
        // itself stays (with its error), so the "won't succeed by
        // retrying" notice remains until discarded or the row is edited
        // again — only the stale local *data* is what this fixes.
        if (isPermanentFailure(error.code, error.message)) {
          await this.revertToServerTruth(entry.table, entry.rowId);
        }
        continue;
      }
      await this.clearOutbox(entry.table, entry.rowId, maxSeq);
    }
  }

  private async revertToServerTruth(table: SyncedTable, rowId: string) {
    const supabase = this.supabase!;
    const { data, error } = await supabase.from(table).select('*').eq('id', rowId).maybeSingle();
    if (error) return; // best-effort — next sync cycle gets another chance
    if (data) {
      await db.table(table).put(normalize(table, rowToDomain<Record<string, unknown>>(data)));
    } else {
      // No server row at all under this id (e.g. deleted by someone else) —
      // don't leave a phantom local row with nothing to revert to.
      await db.table(table).delete(rowId);
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
    if (!this.started) return;
    // One table's pages are still fetched in order (a page's cursor depends
    // on the previous page), but the tables themselves have no dependency on
    // each other — pulling them one after another only serializes their
    // network latency for no reason. Running all of them concurrently turns
    // a first sync's wait from "sum of every table's round-trips" into
    // roughly "the slowest table's round-trips," which is most of the
    // startup delay on a fresh login/device.
    await Promise.all(SYNC_TABLES.map((table) => this.pullTable(table)));
  }

  private async pullTable(table: SyncedTable) {
    const supabase = this.supabase!;
    let cursor = (await db.meta.get(`cursor:${table}`))?.value ?? EPOCH;
    for (;;) {
      if (!this.started) break;
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .gt('updated_at', cursor)
        .order('updated_at', { ascending: true })
        .limit(PAGE);
      if (error) {
        // A request that never reached the server (mobile data drop, app
        // resumed from background) — not a problem with this table.
        if (isFetchFailure(error.message)) throw new Error(NETWORK_UNREACHABLE);
        throw new Error(`pull ${table}: ${error.message}`);
      }
      if (!data?.length) break;

      const pendingIds = new Set(
        (await db.outbox.where('table').equals(table).toArray()).map((e) => e.rowId)
      );
      // Validate rows before bulk insert to catch schema mismatches early.
      // A single .filter() pass, not a for-loop splicing invalid rows out
      // of `incoming` while iterating it — splicing mid-iteration shifts
      // the next element down into the index the iterator has already
      // passed, so two or more consecutive invalid rows in one page let
      // the second one skip validation entirely and reach bulkPut below.
      const incoming = data
        .map((row) => normalize(table, rowToDomain<Record<string, unknown>>(row)))
        .filter((obj) => !pendingIds.has(obj.id as string))
        .filter((row) => {
          const valid = validateNormalizedRow(table, row);
          if (!valid) console.error(`[Sync] Skipping invalid row from ${table}:`, row);
          return valid;
        });

      if (incoming.length > 0) {
        await db.table(table).bulkPut(incoming);
      }

      cursor = (data[data.length - 1] as { updated_at: string }).updated_at;
      await db.meta.put({ key: `cursor:${table}`, value: cursor });
      if (data.length < PAGE) break;
    }
  }
}

export const syncEngine = new SyncEngine();
