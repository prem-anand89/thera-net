import type { Admission, Visit } from './types';

/** A stay with no discharge date (and not deleted): the patient is on the ward. */
export function isOpenAdmission(a: Pick<Admission, 'dischargedOn' | 'deleted'>): boolean {
  return !a.deleted && !a.dischargedOn;
}

/** The one open stay in a list (the server allows at most one per patient). */
export function openAdmissionOf(list: readonly Admission[]): Admission | undefined {
  return list.find(isOpenAdmission);
}

const ONE_DAY = 86_400_000;
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / ONE_DAY);

/** Day of the stay: the admission day is day 1. Never below 1 (a stay dated in the future reads as day 1). */
export function dayOfStay(admittedOn: string, today: string): number {
  return Math.max(1, dayNumber(today) - dayNumber(admittedOn) + 1);
}

/** Why these dates can't be saved, or null. Dates are yyyy-mm-dd. */
export function admissionDateProblem(admittedOn: string, dischargedOn: string | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(admittedOn)) return 'Choose the date of admission.';
  if (dischargedOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dischargedOn)) return 'Choose the discharge date.';
  if (dischargedOn && dischargedOn < admittedOn) return 'The discharge date cannot be before the admission date.';
  return null;
}

/**
 * The server refused a second open stay for a patient (`admissions_one_open_per_patient`): two devices admitted the
 * same patient while offline. The first push won.
 */
export function isDuplicateOpenAdmission(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return error?.code === '23505' && /admissions_one_open_per_patient/.test(error.message ?? '');
}

/** The patient's visits that belong to a stay, re-pointed at another stay (the losing stay's visits move to the surviving one). */
export function repointVisits(visits: readonly Visit[], losingId: string, survivingId: string, now: string): Visit[] {
  return visits
    .filter((v) => v.admissionId === losingId)
    .map((v) => ({ ...v, admissionId: survivingId, updatedAt: now }));
}

/** Default ward & rehab unit presets covering both hospital wards and rehabilitation centres. */
export const DEFAULT_PRESET_WARDS: readonly string[] = [
  'General',
  'Ortho',
  'Neuro',
  'ICU',
  'Private',
  'Rehab Wing',
];

/**
 * The clinic's configured ward / unit presets (or `DEFAULT_PRESET_WARDS` when unset),
 * merged case-insensitively with any wards already used on open stays so existing custom wards always appear.
 */
export function clinicWards(
  clinic: { wards?: readonly string[] | null } | null | undefined,
  stays: readonly { wardBed?: string | null }[] = []
): string[] {
  const base = clinic?.wards && clinic.wards.length > 0 ? clinic.wards : DEFAULT_PRESET_WARDS;
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string | null | undefined) => {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };
  for (const w of base) add(w);
  for (const s of stays) {
    const { ward } = splitWardBed(s.wardBed);
    if (ward) add(ward);
  }
  return out;
}

/**
 * Splits a stored `ward_bed` string into structured `{ ward, bed }` parts:
 * - `"Ortho, Bed 12"` -> `{ ward: "Ortho", bed: "Bed 12" }`
 * - `"Neuro - Room 204"` -> `{ ward: "Neuro", bed: "Room 204" }`
 * - `"ICU Bed 3"` -> `{ ward: "ICU", bed: "Bed 3" }`
 * - `"Bed 12"` or `"Room 101"` -> `{ ward: "", bed: "Bed 12" }` / `{ ward: "", bed: "Room 101" }`
 * - `"Ortho"` -> `{ ward: "Ortho", bed: "" }`
 */
export function splitWardBed(wardBed: string | null | undefined): { ward: string; bed: string } {
  const text = (wardBed ?? '').trim();
  if (!text) return { ward: '', bed: '' };
  if (text.includes(',')) {
    const [first, ...rest] = text.split(',');
    return { ward: first.trim(), bed: rest.join(',').trim() };
  }
  if (/^(bed|room|suite|cabin)\b/i.test(text)) {
    return { ward: '', bed: text };
  }
  const trailingMatch = text.match(/^(.*?)\s*[-–·]?\s*((?:bed|room|suite|cabin)\s*\S+.*)$/i);
  if (trailingMatch && trailingMatch[1].trim()) {
    return { ward: trailingMatch[1].trim(), bed: trailingMatch[2].trim() };
  }
  return { ward: text, bed: '' };
}

/** Joins structured `ward` and `bed` inputs back into the single `ward_bed` string stored in Postgres. */
export function joinWardBed(ward: string | null | undefined, bed: string | null | undefined): string {
  const w = (ward ?? '').trim();
  const b = (bed ?? '').trim();
  if (w && b) return `${w}, ${b}`;
  return w || b;
}

/**
 * The ward a stay is in, for grouping the ward-rounds list. `ward_bed` is one free-text field ("Ortho ward, bed 12"),
 * so the ward is what comes before the first comma, or before a trailing "bed 12"; with neither, the whole text. Empty
 * reads as "No ward set". Matching ignores case so "ortho ward" and "Ortho Ward" group together.
 */
export function wardOf(wardBed: string | null | undefined): { key: string; label: string } {
  const { ward } = splitWardBed(wardBed);
  if (!ward) return { key: '', label: 'No ward set' };
  return { key: ward.toLowerCase(), label: ward };
}
