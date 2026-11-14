import { askConfirm, notify } from '@/lib/notify';
import { repos } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { formatAmount } from '@/domain/money';

/** The "Delete this visit?" text. When money was recorded on the visit, say it goes too (and so leaves the Daybook). */
export function deleteVisitMessage(collectedPaise: number): string {
  if (collectedPaise <= 0) return 'It is removed from the records.';
  return `It is removed from the records, and the ${formatAmount(collectedPaise)} recorded as collected on it is removed from the Daybook too. If the patient has paid, record the payment again on the new visit.`;
}

/** "Delete this visit?" confirm + soft delete, shared by the Ledger, Workspace, Patient and Edit-visit screens. Errors become a notice. */
export async function confirmAndDeleteVisit(visitId: string): Promise<void> {
  let collected = 0;
  try {
    collected = (await repos.payments.listByVisit(visitId)).reduce((sum, p) => sum + p.amountPaise, 0);
  } catch {
    // The amount only sharpens the wording; the delete itself does not depend on it.
  }
  const ok = await askConfirm({
    title: 'Delete this visit?',
    message: deleteVisitMessage(collected),
    confirmLabel: 'Delete visit',
    destructive: true,
  });
  if (!ok) return;
  try {
    await repos.visits.softDelete(visitId);
  } catch (e) {
    notify.error(toFriendlyMessage(e));
  }
}
