import type { UUID, Visit } from '@/domain/types';
import type { UtilisationVisit } from '@/domain/utilisation';
import { appointmentMinutes } from '@/domain/schedule';
import type { Repos } from '@/repositories/types';

/**
 * Visits ready for the utilisation maths: each visit that has live service lines gets them (`items`)
 * plus its sitting length — the linked appointment's duration, falling back to the clinic slot. Visits
 * without lines are returned untouched so they keep the legacy "one slot" rule. One range query for the
 * lines and one for appointments, however many visits there are.
 */
export async function loadUtilisationVisits(
  clinicId: UUID,
  visits: Visit[],
  range: { from: string; to: string },
  slotMinutes: number,
  repos: Pick<Repos, 'visitItems' | 'appointments'>,
): Promise<(Visit & UtilisationVisit)[]> {
  if (visits.length === 0) return visits;
  const [items, appointments] = await Promise.all([
    repos.visitItems.listByClinic(clinicId, range),
    repos.appointments.listByClinic(clinicId),
  ]);
  const itemsByVisit = new Map<UUID, typeof items>();
  for (const i of items) {
    if (i.deleted) continue;
    const list = itemsByVisit.get(i.visitId);
    if (list) list.push(i);
    else itemsByVisit.set(i.visitId, [i]);
  }
  const sittingByVisit = new Map<UUID, number>();
  for (const a of appointments) {
    if (a.visitId && !sittingByVisit.has(a.visitId)) sittingByVisit.set(a.visitId, appointmentMinutes(a, slotMinutes));
  }
  return visits.map((v) => {
    const lines = itemsByVisit.get(v.id);
    if (!lines) return v;
    return { ...v, items: lines, sittingMinutes: sittingByVisit.get(v.id) ?? slotMinutes };
  });
}
