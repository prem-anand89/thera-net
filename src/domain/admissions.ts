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
