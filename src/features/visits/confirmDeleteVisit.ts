import { askConfirm, notify } from '@/lib/notify';
import { repos } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';

/** "Delete this visit?" confirm + soft delete, shared by the Ledger and Workspace rows. Errors become a notice. */
export async function confirmAndDeleteVisit(visitId: string): Promise<void> {
  const ok = await askConfirm({
    title: 'Delete this visit?',
    message: 'It is removed from the records.',
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
