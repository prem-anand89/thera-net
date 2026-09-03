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
  invoices: { one: 'invoice', many: 'invoices' },
  invoice_payments: { one: 'payment change', many: 'payment changes' },
  payments: { one: 'payment', many: 'payments' },
  settlements: { one: 'settlement', many: 'settlements' },
  consultation_notes: { one: 'clinical note', many: 'clinical notes' },
  patient_module_enrollments: { one: 'patient setup change', many: 'patient setup changes' },
  patient_advances: { one: 'advance payment', many: 'advance payments' },
  feedback_requests: { one: 'feedback request', many: 'feedback requests' },
  feedback_responses: { one: 'feedback response', many: 'feedback responses' },
  appointment_requests: { one: 'booking request', many: 'booking requests' },
  appointments: { one: 'appointment', many: 'appointments' },
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
