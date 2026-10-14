import type { UUID, Visit } from '@/domain/types';
import type { Paise } from '@/domain/money';

/**
 * Slices `amountPaise` across `visits` in date order, each slice capped at
 * that visit's own outstanding bill (`actualBillPaise` minus what
 * `paidByVisit` already shows for it) — shared by
 * `paymentService.recordInvoicePayment` (invoice draw-down) and this
 * module's `applyAdvance` (advance draw-down) so both paths allocate
 * identically instead of maintaining two copies of the same loop.
 */
export async function allocateAcrossVisits(
  visits: Visit[],
  paidByVisit: Map<UUID, Paise>,
  amountPaise: Paise,
  makePayment: (visitId: UUID, slicePaise: Paise) => Promise<void>
): Promise<void> {
  let toAllocate = amountPaise;
  for (const v of visits) {
    if (toAllocate <= 0) break;
    const visitRemaining = v.actualBillPaise - (paidByVisit.get(v.id) ?? 0);
    if (visitRemaining <= 0) continue;
    const slice = Math.min(visitRemaining, toAllocate);
    await makePayment(v.id, slice);
    toAllocate -= slice;
  }
}
