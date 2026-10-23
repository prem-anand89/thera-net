import type { UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';

/**
 * How many records still point at a therapist — the app-side mirror of the server's
 * `hard_delete_therapist()` count, so the admin sees the usual "deactivate instead" message before
 * trying a delete the server would refuse. A visit counts once however the therapist is on it: as its
 * therapist, as the old split's shared therapist, as the assistant on one of its service lines, or as the
 * holder of one of its revenue shares. Lines and shares are read WITH their soft-deleted rows: on the
 * server a soft-deleted row still references the therapist and blocks the delete.
 */
export async function countTherapistLinkedRecords(
  repos: Pick<Repos, 'visits' | 'visitItems' | 'visitCredits' | 'consultationNotes' | 'invoices'>,
  clinicId: UUID,
  therapistId: UUID
): Promise<number> {
  const [visits, items, credits, notes, invoices] = await Promise.all([
    repos.visits.list({ clinicId }),
    repos.visitItems.listByClinicIncludingDeleted(clinicId),
    repos.visitCredits.listByClinicIncludingDeleted(clinicId),
    repos.consultationNotes.listByClinic(clinicId),
    repos.invoices.list(clinicId),
  ]);
  const visitIds = new Set<UUID>([
    ...visits.filter((v) => v.therapistId === therapistId || v.sharedTherapistId === therapistId).map((v) => v.id),
    ...items.filter((i) => i.assistingTherapistId === therapistId).map((i) => i.visitId),
    ...credits.filter((c) => c.therapistId === therapistId).map((c) => c.visitId),
  ]);
  const linkedNotes = notes.filter((n) => n.therapistId === therapistId).length;
  const linkedInvoices = invoices.filter((i) => i.therapistId === therapistId).length;
  return visitIds.size + linkedNotes + linkedInvoices;
}
