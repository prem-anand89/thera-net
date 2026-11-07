import type { Invoice, Visit } from './types';

/**
 * The invoices that belong to one patient, newest first. A bill is the patient's when its snapshot carries their
 * permanent id, or when a visit billed on it is theirs (bills issued before the snapshot kept the id have only that).
 */
export function invoicesForPatient(
  patientId: string,
  invoices: readonly Invoice[],
  visits: readonly Pick<Visit, 'invoiceId' | 'patientId' | 'deleted'>[]
): Invoice[] {
  const viaVisit = new Set<string>();
  for (const v of visits) {
    if (!v.deleted && v.invoiceId && v.patientId === patientId) viaVisit.add(v.invoiceId);
  }
  const seen = new Set<string>();
  const mine: Invoice[] = [];
  for (const inv of invoices) {
    if (seen.has(inv.id)) continue;
    if (inv.patientSnapshot?.patientId === patientId || viaVisit.has(inv.id)) {
      seen.add(inv.id);
      mine.push(inv);
    }
  }
  return mine.sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : a.issuedAt > b.issuedAt ? -1 : 0));
}
