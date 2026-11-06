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

/** Home visits are on for this clinic (the patient address, Open in Maps). */
export function homeCareOn(clinic: { careLocations?: readonly string[] | null } | null | undefined): boolean {
  return clinicCareLocations(clinic).includes('home');
}

/** A record's location. Most older visits have none, and an appointment from an older cache lacks it: both read as clinic. */
export function locationOf(record: { location?: string | null } | null | undefined): CareLocation {
  return ALL.find((l) => l === record?.location) ?? 'clinic';
}
