import { locationOf } from './careLocations';
import type { CareLocation, ConsultationNote, Visit } from './types';

/** Where the visits on one invoice happened: one place, or `mixed` when they were in more than one. */
export type InvoicePlace = CareLocation | 'mixed';

const ORDER: CareLocation[] = ['clinic', 'home', 'ward'];

/** The place of service for an invoice from its visits' locations (a visit with none counts as the clinic). */
export function placeOfServiceFor(visits: Pick<Visit, 'location'>[]): { place: InvoicePlace; locations: CareLocation[] } {
  const present = new Set<CareLocation>(visits.map((v) => locationOf(v)));
  if (present.size === 0) present.add('clinic');
  const locations = ORDER.filter((l) => present.has(l));
  return { place: locations.length > 1 ? 'mixed' : locations[0], locations };
}

const TREATMENT_TEXT_LIMIT = 200;

/**
 * "Treatment performed" for an invoice, from every visit on it: each treatment once, in the order first done, then each
 * visit's own words once, joined as the visit lists do (names, an em dash, the notes). Cut at 200 characters.
 */
export function treatmentsFor(
  visits: Pick<Visit, 'visitDate' | 'treatmentIds' | 'treatmentNotes'>[],
  catalog: { id: string; name: string }[]
): string {
  const nameOf = new Map(catalog.map((t) => [t.id, t.name]));
  const names: string[] = [];
  const notes: string[] = [];
  for (const v of [...visits].sort((a, b) => a.visitDate.localeCompare(b.visitDate))) {
    for (const id of v.treatmentIds ?? []) {
      const name = nameOf.get(id);
      if (name && !names.includes(name)) names.push(name);
    }
    const note = v.treatmentNotes?.trim();
    if (note && !notes.includes(note)) notes.push(note);
  }
  const parts: string[] = [];
  if (names.length) parts.push(names.join(', '));
  if (notes.length) parts.push(notes.join(', '));
  const text = parts.join(' — ');
  return text.length > TREATMENT_TEXT_LIMIT ? `${text.slice(0, TREATMENT_TEXT_LIMIT - 1)}…` : text;
}

function hasReferral(n: ConsultationNote): boolean {
  const payload = n.assessmentPayload as { referral?: unknown } | null;
  return Boolean(payload && payload.referral);
}

/**
 * The note an invoice's referral block (diagnosis, referring physician) is read from. A note written for one of these visits
 * wins (the latest visit's first). Otherwise the latest completed initial/follow-up note updated on or before the last visit's
 * date, so a bill for last month's visits does not show this month's diagnosis. Failing that, the latest completed one.
 * A session note, a draft, or a note with no referral block is never used.
 */
export function pickReferralNote(
  notes: ConsultationNote[],
  visits: Pick<Visit, 'id' | 'visitDate'>[]
): ConsultationNote | undefined {
  const usable = notes.filter((n) => n.status === 'completed' && n.noteMode !== 'session' && hasReferral(n));
  const newestFirst = [...visits].sort((a, b) => b.visitDate.localeCompare(a.visitDate));
  for (const v of newestFirst) {
    const linked = usable.find((n) => n.visitId === v.id);
    if (linked) return linked;
  }
  const byRecency = [...usable].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const lastVisitDate = newestFirst[0]?.visitDate;
  const inPeriod = lastVisitDate ? byRecency.find((n) => n.updatedAt.slice(0, 10) <= lastVisitDate) : undefined;
  return inPeriod ?? byRecency[0];
}

const PLACE_LABEL: Record<CareLocation, string> = { clinic: 'Clinic', home: 'Home (domiciliary)', ward: 'Ward' };
const PLACE_SHORT: Record<CareLocation, string> = { clinic: 'Clinic', home: 'Home', ward: 'Ward' };

/** How a bill prints the place of service: "Clinic", "Home (domiciliary)", "Ward", or "Clinic and Home" when mixed. */
export function placeOfServiceLabel(snapshot: { placeOfService?: InvoicePlace | null; locations?: CareLocation[] } | null | undefined): string | null {
  const place = snapshot?.placeOfService;
  if (!place) return null;
  if (place === 'mixed') {
    const names = (snapshot?.locations ?? []).map((l) => PLACE_SHORT[l]);
    return names.length > 1 ? names.join(' and ') : 'Clinic and Home';
  }
  return PLACE_LABEL[place];
}
