import type { CareLocation } from './types';

/** Screen words for where a patient is seen. */
export const CARE_LOCATION_LABELS: Record<CareLocation, string> = {
  clinic: 'Clinic',
  home: 'Home visit',
  ward: 'Inpatient',
};

const ALL: readonly CareLocation[] = ['clinic', 'home', 'ward'];

/**
 * Where this clinic sees patients, always in the same order and never empty. Older cached rows lack the setting and
 * unknown values are dropped, so anything unclear reads as clinic only: home care and inpatient stay off until a clinic
 * turns them on.
 */
export function clinicCareLocations(clinic: { careLocations?: readonly string[] | null } | null | undefined): CareLocation[] {
  const set = ALL.filter((l) => clinic?.careLocations?.includes(l));
  return set.length > 0 ? set : ['clinic'];
}

/** More than one location: only then does the app show a location choice, badge, filter or breakdown. */
export function offersLocationChoice(clinic: { careLocations?: readonly string[] | null } | null | undefined): boolean {
  return clinicCareLocations(clinic).length > 1;
}

/**
 * More than one place a visit can be booked or logged at (inpatient is not one of them: it comes from an admission).
 * The Place pickers, filters and service defaults use this, so a clinic with only Clinic and Inpatient on is not asked
 * to choose between one thing.
 */
export function offersBookingChoice(clinic: { careLocations?: readonly string[] | null } | null | undefined): boolean {
  return bookableLocations(clinic).length > 1;
}

/** Home visits are on for this clinic (the patient address, Open in Maps). */
export function homeCareOn(clinic: { careLocations?: readonly string[] | null } | null | undefined): boolean {
  return clinicCareLocations(clinic).includes('home');
}

/** A record's location. Most older visits have none, and an appointment from an older cache lacks it: both read as clinic. */
export function locationOf(record: { location?: string | null } | null | undefined): CareLocation {
  return ALL.find((l) => l === record?.location) ?? 'clinic';
}

/** Places an appointment or visit can be booked at today (inpatient is not bookable yet). */
export function bookableLocations(clinic: { careLocations?: readonly string[] | null } | null | undefined): CareLocation[] {
  return clinicCareLocations(clinic).filter((l) => l !== 'ward');
}

/**
 * Where a new booking starts: the service's own default when the clinic offers it, else Clinic when the clinic offers
 * it, else the clinic's first place (a home-only clinic starts on Home).
 */
export function defaultBookingLocation(
  clinic: { careLocations?: readonly string[] | null } | null | undefined,
  service?: { defaultLocation?: string | null } | null
): CareLocation {
  const offered = bookableLocations(clinic);
  const fromService = offered.find((l) => l === service?.defaultLocation);
  return fromService ?? (offered.includes('clinic') ? 'clinic' : offered[0] ?? 'clinic');
}

/**
 * The place to show beside a visit or appointment: the label for home or inpatient, and nothing for the clinic or when
 * the clinic only sees patients in one place (so a clinic-only clinic's screens stay as they are).
 */
export function placeLabelFor(
  clinic: { careLocations?: readonly string[] | null } | null | undefined,
  record: { location?: string | null } | null | undefined
): string | null {
  if (!offersLocationChoice(clinic)) return null;
  const place = locationOf(record);
  return place === 'clinic' ? null : CARE_LOCATION_LABELS[place];
}
