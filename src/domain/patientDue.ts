import { computeVisitPaymentState, visitDuePaise } from './paymentState';
import type { Paise } from './money';
import type { PaymentStatus, UUID, Visit } from './types';

/**
 * What one patient still owes, from their own visits: each live visit's due amount by the same rule the Ledger
 * and Workspace use (`computeVisitPaymentState` + `visitDuePaise`), so this line can never disagree with them.
 * `unpaidVisits` counts visits that owe something; a ₹0 package session never does.
 */
export function patientDue(
  visits: Pick<Visit, 'id' | 'deleted' | 'actualBillPaise' | 'invoiceId'>[],
  collectedByVisitId: ReadonlyMap<UUID, Paise>,
  invoiceStatusById: ReadonlyMap<UUID, PaymentStatus>
): { duePaise: Paise; unpaidVisits: number } {
  let duePaise = 0;
  let unpaidVisits = 0;
  for (const visit of visits) {
    if (visit.deleted) continue;
    const collected = collectedByVisitId.get(visit.id) ?? 0;
    const state = computeVisitPaymentState(
      visit.actualBillPaise,
      visit.invoiceId,
      collected,
      visit.invoiceId ? invoiceStatusById.get(visit.invoiceId) : undefined
    );
    const due = visitDuePaise(state, visit.actualBillPaise, collected);
    if (due > 0) {
      duePaise += due;
      unpaidVisits += 1;
    }
  }
  return { duePaise, unpaidVisits };
}
