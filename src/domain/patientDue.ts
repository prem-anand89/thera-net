import { computeVisitPaymentState, visitDuePaise } from './paymentState';
import { isInpatientVisit } from './departmentMoney';
import { inDepartment, type Department } from './departments';
import type { Paise } from './money';
import type { PaymentStatus, UUID, Visit } from './types';

export interface PatientDueOptions {
  department?: Department;
}

/**
 * What one patient still owes, from their own visits: each live visit's due amount by the same rule the Ledger
 * and Workspace use (`computeVisitPaymentState` + `visitDuePaise`), so this line can never disagree with them.
 * `unpaidVisits` counts visits that owe something; a ₹0 package session never does, nor does an un-invoiced IP
 * stay visit.
 */
export function patientDue(
  visits: (Pick<Visit, 'id' | 'deleted' | 'actualBillPaise' | 'invoiceId'> & {
    location?: string | null;
    admissionId?: string | null;
  })[],
  collectedByVisitId: ReadonlyMap<UUID, Paise>,
  invoiceStatusById: ReadonlyMap<UUID, PaymentStatus>,
  options?: PatientDueOptions
): { duePaise: Paise; unpaidVisits: number } {
  let duePaise = 0;
  let unpaidVisits = 0;
  for (const visit of visits) {
    if (visit.deleted) continue;
    if (options?.department && !inDepartment(options.department, visit)) continue;
    if (isInpatientVisit(visit) && !visit.invoiceId) continue;
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
