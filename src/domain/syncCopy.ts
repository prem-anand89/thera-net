import type { SyncedTable } from '@/lib/db';

const TABLE_PHRASE: Record<SyncedTable, { one: string; many: string }> = {
  clinics: { one: 'clinic change', many: 'clinic changes' },
  therapists: { one: 'team change', many: 'team changes' },
  service_catalog: { one: 'service change', many: 'service changes' },
  no_return_reason_catalog: { one: 'settings change', many: 'settings changes' },
  referring_source_catalog: { one: 'settings change', many: 'settings changes' },
  treatment_catalog: { one: 'settings change', many: 'settings changes' },
  patients: { one: 'patient change', many: 'patient changes' },
  visits: { one: 'visit', many: 'visits' },
  visit_items: { one: 'visit service', many: 'visit services' },
  visit_credits: { one: 'revenue share', many: 'revenue shares' },
  invoices: { one: 'invoice', many: 'invoices' },
  invoice_payments: { one: 'payment change', many: 'payment changes' },
  payments: { one: 'payment', many: 'payments' },
  settlements: { one: 'settlement', many: 'settlements' },
  settlement_payments: { one: 'settlement payment', many: 'settlement payments' },
  consultation_notes: { one: 'clinical note', many: 'clinical notes' },
  patient_module_enrollments: { one: 'patient setup change', many: 'patient setup changes' },
  patient_advances: { one: 'advance payment', many: 'advance payments' },
  feedback_requests: { one: 'feedback request', many: 'feedback requests' },
  feedback_responses: { one: 'feedback response', many: 'feedback responses' },
  appointment_requests: { one: 'booking request', many: 'booking requests' },
  appointments: { one: 'appointment', many: 'appointments' },
  clinic_closed_dates: { one: 'closed day', many: 'closed days' },
  shift_templates: { one: 'shift template', many: 'shift templates' },
  therapist_shift_assignments: { one: 'shift assignment', many: 'shift assignments' },
  user_seen_markers: { one: 'notification marker', many: 'notification markers' },
  user_push_preferences: { one: 'notification setting', many: 'notification settings' },
};

export function syncFailureHeadline(tables: string[]): string {
  const counts = new Map<string, number>();
  for (const table of tables) {
    counts.set(table, (counts.get(table) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([table, n]) => {
    const phrase = TABLE_PHRASE[table as SyncedTable] ?? { one: 'change', many: 'changes' };
    if (n === 1) return `1 ${phrase.one}`;
    return `${n} ${phrase.many}`;
  });
  if (parts.length === 0) return 'Changes not saved';
  if (parts.length === 1) return `${parts[0]} not saved`;
  return `${parts.join(', ')} not saved`;
}

export function syncRecordLabel(table: string): string {
  const phrase = TABLE_PHRASE[table as SyncedTable];
  return phrase?.one ?? 'change';
}

/**
 * Data-freshness caption for a screen whose numbers are derived from local
 * Dexie data — "as of the last sync" if everything relevant has pushed, or
 * "includes N unsynced X" when it hasn't, since an unsynced local change
 * means the number is actually *more* current than the last-sync timestamp
 * would suggest, not less. Shared by every screen with the same caveat
 * (Ledger's totals, Workspace's "Collected today" et al.) rather than each
 * reimplementing the same two-branch string.
 */
export function syncFreshnessCaption(
  unsyncedCount: number,
  table: SyncedTable,
  lastSyncAt: number | string | null | undefined
): string | null {
  if (unsyncedCount > 0) {
    const phrase = TABLE_PHRASE[table] ?? { one: 'change', many: 'changes' };
    const label = unsyncedCount === 1 ? phrase.one : phrase.many;
    return `Includes ${unsyncedCount} unsynced ${label}.`;
  }
  if (lastSyncAt) {
    return `As of last sync ${new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
  }
  return null;
}

/** A successful sync older than this, while online, no longer counts as "all good". */
export const SYNC_STALE_MS = 30 * 60 * 1000;

export function isSyncStale(lastSuccessAt: number | undefined, now: number): boolean {
  return lastSuccessAt !== undefined && now - lastSuccessAt > SYNC_STALE_MS;
}

/** "Last synced just now / 12 min ago / at 14:32 / 12 Oct, 14:32". */
export function formatLastSynced(lastSuccessAt: number | undefined, now: number): string {
  if (lastSuccessAt === undefined) return 'Not synced yet on this device';
  const minutes = Math.floor((now - lastSuccessAt) / 60_000);
  if (minutes < 1) return 'Last synced just now';
  if (minutes < 60) return `Last synced ${minutes} min ago`;
  const at = new Date(lastSuccessAt);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (at.toDateString() === new Date(now).toDateString()) return `Last synced at ${time}`;
  return `Last synced ${at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
}
