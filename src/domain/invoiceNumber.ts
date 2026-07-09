/**
 * Display formatting only — sequence allocation happens server-side in the
 * issue_invoice() Postgres function so numbers stay gap-free under
 * concurrency. Format: BM/26-27/0001
 */
export function formatInvoiceNo(prefix: string, fyLabel: string, seq: number): string {
  return `${prefix}/${fyLabel}/${String(seq).padStart(4, '0')}`;
}
