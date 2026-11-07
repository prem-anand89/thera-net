import { hasDue } from '@/domain/paymentState';
import { isFullyPartnerCollected } from '@/domain/paymentMethods';
import type { VisitCardData } from '@/components/visit/types';

type Row = Pick<
  VisitCardData,
  'visitId' | 'visitDate' | 'billPaise' | 'invoiceId' | 'paymentState' | 'partnerCollectedPaise' | 'packageInvoicePending'
>;

/**
 * Which of a patient's visits can be ticked in Visit history: with billing rights, a visit that is not on an invoice yet
 * and was not paid entirely at the partner's counter; without, a visit with something still owed (they can only collect).
 * A ₹0 session of a package that is already invoiced is never selectable: it belongs to that invoice, and an invoice of
 * only ₹0 sessions has nothing to bill (the server refuses it).
 */
export function selectableForBilling<T extends Row>(rows: T[], opts: { canBill: boolean; canCollect: boolean }): T[] {
  return rows.filter((row) =>
    opts.canBill
      ? !row.invoiceId && !row.packageInvoicePending && !isFullyPartnerCollected(row.billPaise, row.partnerCollectedPaise)
      : opts.canCollect && hasDue(row.paymentState)
  );
}

export type BillingRange = 'all' | 'this_month' | 'last_month';

function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * The ids to tick for "Select all unbilled" and the month shortcuts, oldest first. `today` is the clinic's local date
 * (`YYYY-MM-DD`); months are calendar months of the visit date.
 */
export function unbilledInRange<T extends Row>(
  rows: T[],
  opts: { canBill: boolean; canCollect: boolean },
  range: BillingRange,
  today: string
): string[] {
  const thisMonth = monthOf(today);
  const wanted = range === 'this_month' ? thisMonth : range === 'last_month' ? previousMonth(thisMonth) : null;
  return selectableForBilling(rows, opts)
    .filter((r) => wanted === null || monthOf(r.visitDate) === wanted)
    .sort((a, b) => a.visitDate.localeCompare(b.visitDate))
    .map((r) => r.visitId);
}
