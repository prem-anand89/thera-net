import { isPermanentLinkError, listPendingLinks, removePendingLink } from './pendingLinks';
import { db, ALL_SYNCED_TABLES, CLIENT_WRITABLE_TABLES, type SyncedTable } from '@/lib/db';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { domainToRow, rowToDomain } from '@/repositories/rowMapping';
import { onLocalWrite } from '@/repositories/local';
import { syncStatus, isPermanentFailure } from './status';
import { coerceReferringSource, type Patient } from '@/domain/types';
import { isMrnoCollision, reissueWalkInMrno } from '@/domain/walkInMrno';
import { notify } from '@/lib/notify';

/** Shown (and matched by toFriendlyMessage) when the server can't be reached. */
const LAST_SUCCESS_META_KEY = 'lastSuccessAt';
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
 * - pull: per-table delta from the cursor minus a short overlap, paged by
 *   (updated_at, id) so rows sharing a timestamp across a page edge are never
 *   skipped (server-authoritative timestamps); rows with a pending local edit
 *   are skipped (local wins until its push lands, then the next pull settles
 *   it — last-write-wins)
 * - deletes: server rows deleted anywhere leave a sync_tombstones marker,
 *   pulled after the tables; the local copy is removed unless it was changed
 *   after the delete or has a pending edit
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
/**
 * Each pull starts this far before the saved cursor. `updated_at` is set when a transaction starts, so a
 * slow transaction can commit after rows with later timestamps were already pulled; re-reading a short
 * window catches it. Re-pulled rows are identical, so the cost is a few repeated rows per table.
 */
export const PULL_OVERLAP_MS = 2 * 60_000;
const TOMBSTONES = 'sync_tombstones';

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

/** Where a pull starts: the saved cursor minus PULL_OVERLAP_MS, never before the epoch. */
export function pullStartFrom(cursor: string): string {
  const ms = Date.parse(cursor);
  if (!Number.isFinite(ms)) return EPOCH;
  return new Date(Math.max(0, ms - PULL_OVERLAP_MS)).toISOString();
}

/** PostgREST `or` filter for "after (updatedAt, id)": the next page of an (updated_at, id) ordered pull. */
export function afterKeyFilter(updatedAt: string, id: string): string {
  const ts = `"${updatedAt}"`;
  return `updated_at.gt.${ts},and(updated_at.eq.${ts},id.gt.${id})`;
}

/** A membership as reconcileClinicMembership remembers it, so a role change counts as new access. */
export function membershipKey(clinicId: string, role: string): string {
  return `${clinicId}:${role}`;
}

export interface Tombstone {
  table: string;
  rowId: string;
  deletedAt: string;
}

/**
 * Which local rows a batch of tombstones removes: only synced tables, never a row with a pending local
 * edit, and never a row changed after the delete (it was created again under the same id).
 */
export function rowsToDelete(
  tombstones: Tombstone[],
  pending: ReadonlySet<string>,
  localUpdatedAt: (table: string, rowId: string) => string | undefined
): { table: SyncedTable; rowId: string }[] {
  const synced = new Set<string>(ALL_SYNCED_TABLES);
  return tombstones
    .filter((t) => synced.has(t.table) && !pending.has(`${t.table}:${t.rowId}`))
    .filter((t) => {
      const local = localUpdatedAt(t.table, t.rowId);
      return local !== undefined && local <= t.deletedAt;
    })
    .map((t) => ({ table: t.table as SyncedTable, rowId: t.rowId }));
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
    // Restore the last successful sync time so the badge can say when it was,
    // even right after a restart while offline. Display only (see SyncStatus).
    void db.meta
      .get(LAST_SUCCESS_META_KEY)
      .then((m) => {
        const at = Number(m?.value);
        if (Number.isFinite(at) && at > 0 && !syncStatus.get().lastSuccessAt) {
          syncStatus.set({ lastSuccessAt: at });
        }
      })
      .catch(() => {});
    this.schedule();
  }

  /** Debounced full sync (push then pull). */
  schedule(delayMs = 300) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.sync(), delayMs);
  }

  async sync(): Promise<void> {
    // Stopped (signed out, or paused while another account's unsynced work is
    // awaiting a decision): never push, a stray schedule() must not leak it.
    if (!this.started || !this.supabase || !navigator.onLine) return;
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
      const completedAt = Date.now();
      syncStatus.set({ lastSyncAt: completedAt, lastSuccessAt: completedAt, error: null });
      void db.meta.put({ key: LAST_SUCCESS_META_KEY, value: String(completedAt) }).catch(() => {});
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
      .select('clinic_id, role')
      .eq('user_id', userId);
    if (error) return; // best-effort — next sync cycle gets another chance
    // Remembered with the role, so a role change (front desk -> therapist) re-pulls rows the old role couldn't see.
    const nowIds = (data ?? []).map((r) => membershipKey(r.clinic_id as string, r.role as string)).sort();
    // Front desk can't read clinical notes on the server; drop any this device cached under an earlier role.
    for (const r of data ?? []) {
      if (r.role === 'front_desk') await db.consultation_notes.where('clinicId').equals(r.clinic_id as string).delete();
    }
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
    // The newest queued entry per row: a user edit adds a newer one, which is
    // how a row blocked by a patient-ID collision gets retried.
    const newestSeq = new Map<string, number>();
    for (const e of entries) newestSeq.set(`${e.table}:${e.rowId}`, e.seq!);
    for (const entry of entries) {
      const key = `${entry.table}:${entry.rowId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // A typed patient ID already taken on the server can't succeed until the
      // ID is edited. Don't hammer the server with it on every sync cycle.
      if (
        entry.table === 'patients' &&
        entry.error &&
        isMrnoCollision({ code: entry.errorCode, message: entry.error }) &&
        newestSeq.get(key) === entry.seq
      ) {
        continue;
      }

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
      let { error } = await supabase.from(entry.table).upsert(payload);
      // Two devices that were offline can mint the same walk-in ID. The server
      // rejects the later one; give it the next free number and push again
      // rather than treating it as a permanent failure (which would revert and
      // DELETE the patient locally and strand its visits).
      for (let attempt = 0; attempt < 3 && error && entry.table === 'patients' && isMrnoCollision(error); attempt++) {
        const reissued = await this.reissuePatientMrno(row as Patient);
        if (!reissued) break;
        ({ error } = await supabase.from(entry.table).upsert(domainToRow(reissued as unknown as Record<string, unknown>)));
      }
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
        // A patient-ID collision is the exception: there is no server row under
        // this id, so reverting would delete the patient locally and strand its
        // visits. Keep the patient; the error stays visible until the ID is fixed.
        if (isPermanentFailure(error.code, error.message) && !(entry.table === 'patients' && isMrnoCollision(error))) {
          await this.revertToServerTruth(entry.table, entry.rowId);
        }
        continue;
      }
      await this.clearOutbox(entry.table, entry.rowId, maxSeq);
    }
  }

  /**
   * Replaces an auto-minted, colliding walk-in ID with the next free one
   * (local + server) and returns the updated row, or null when it can't. The
   * row is re-read inside a transaction so an edit made while the server call
   * was in flight isn't overwritten by a stale snapshot.
   */
  private async reissuePatientMrno(patient: Patient): Promise<Patient | null> {
    if (patient.mrnoSource !== 'auto') return null; // a typed hospital ID is the user's to fix
    const match = /^(.*?)(\d{2})-\d+$/.exec(patient.mrno);
    if (!match) return null;
    const [, prefix, yy] = match;
    const supabase = this.supabase!;
    const escapedPrefix = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data, error } = await supabase
      .from('patients')
      .select('mrno')
      .eq('clinic_id', patient.clinicId)
      .like('mrno', `${escapedPrefix}${yy}-%`)
      .order('mrno', { ascending: false })
      .limit(500);
    if (error) return null;
    const local = (await db.patients.where('clinicId').equals(patient.clinicId).toArray()).map((p) => p.mrno);
    const fresh = reissueWalkInMrno(patient.mrno, [...local, ...(data ?? []).map((r) => r.mrno as string)]);
    if (!fresh || fresh === patient.mrno) return null;
    const oldMrno = patient.mrno;
    const updated = await db.transaction('rw', db.patients, async () => {
      const current = await db.patients.get(patient.id);
      if (!current) return null;
      const next = { ...current, mrno: fresh, updatedAt: new Date().toISOString() };
      await db.patients.put(next);
      return next;
    });
    if (updated) {
      notify.info(`Patient ID ${oldMrno} was already taken on another device, so ${updated.name} is now ${fresh}.`);
    }
    return updated;
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
    // After the tables, so a row deleted and then created again under the same id is already current.
    await this.pullTombstones();
  }

  /**
   * Pages a table in (updated_at, id) order from the saved cursor (minus the overlap) and hands each page
   * to `onPage`. The cursor moves only after a page is handled, so a failure resumes where it stopped.
   */
  private async pullPages(table: string, onPage: (rows: Record<string, unknown>[]) => Promise<void>) {
    const supabase = this.supabase!;
    const cursorKey = `cursor:${table}`;
    const saved = (await db.meta.get(cursorKey))?.value ?? EPOCH;
    let after: { updatedAt: string; id: string } | null = null;
    for (;;) {
      if (!this.started) break;
      let query = supabase.from(table).select('*');
      query = after ? query.or(afterKeyFilter(after.updatedAt, after.id)) : query.gte('updated_at', pullStartFrom(saved));
      const { data, error } = await query
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(PAGE);
      if (error) {
        // A request that never reached the server (mobile data drop, app
        // resumed from background) — not a problem with this table.
        if (isFetchFailure(error.message)) throw new Error(NETWORK_UNREACHABLE);
        throw new Error(`pull ${table}: ${error.message}`);
      }
      if (!data?.length) break;
      await onPage(data as Record<string, unknown>[]);
      const last = data[data.length - 1] as { updated_at: string; id: string };
      after = { updatedAt: last.updated_at, id: last.id };
      if (last.updated_at > saved) await db.meta.put({ key: cursorKey, value: last.updated_at });
      if (data.length < PAGE) break;
    }
  }

  private async pullTombstones() {
    await this.pullPages(TOMBSTONES, async (rows) => {
      const tombstones: Tombstone[] = rows.map((r) => ({
        table: r.table_name as string,
        rowId: r.row_id as string,
        deletedAt: r.updated_at as string,
      }));
      const pending = new Set((await db.outbox.toArray()).map((e) => `${e.table}:${e.rowId}`));
      const local = new Map<string, string>();
      for (const t of tombstones) {
        if (!(ALL_SYNCED_TABLES as readonly string[]).includes(t.table)) continue;
        const row = (await db.table(t.table).get(t.rowId)) as { updatedAt?: string } | undefined;
        if (row) local.set(`${t.table}:${t.rowId}`, row.updatedAt ?? '');
      }
      for (const { table, rowId } of rowsToDelete(tombstones, pending, (tb, id) => local.get(`${tb}:${id}`))) {
        await db.table(table).delete(rowId);
      }
    });
  }

  private async pullTable(table: SyncedTable) {
    await this.pullPages(table, async (data) => {
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
    });
  }

}

export const syncEngine = new SyncEngine();
