import { clinicCareLocations, locationOf } from './careLocations';
import type { CareLocation } from './types';

/**
 * Departments. Each is a separate ledger with its own collections, bills and revenue; nothing is shown across them. A
 * department is a stored care location: 'clinic' = OP, 'home' = Home care, 'ward' = IP. The screen words are here.
 */
export type Department = CareLocation;

export const DEPARTMENT_LABELS: Record<Department, string> = { clinic: 'OP', home: 'Home care', ward: 'IP' };

/** Longer wording for places with room (Settings, the Team form). */
export const DEPARTMENT_NAMES: Record<Department, string> = { clinic: 'Outpatient (OP)', home: 'Home care', ward: 'Inpatient (IP)' };

type ClinicLike = { careLocations?: readonly string[] | null } | null | undefined;

/** The departments a clinic has, in the fixed order OP, Home care, IP (never empty). */
export function clinicDepartments(clinic: ClinicLike): Department[] {
  return clinicCareLocations(clinic);
}

/**
 * The departments a person can open. An admin sees every department the clinic has. Anyone else sees the ones assigned to
 * their login (`null` or empty = no restriction), limited to departments the clinic still has; an assignment that matches
 * nothing the clinic has (a department switched off since) falls back to all of them rather than showing nothing.
 */
export function visibleDepartments(
  clinic: ClinicLike,
  access: { role: string; departments?: readonly string[] | null }
): Department[] {
  const all = clinicDepartments(clinic);
  if (access.role === 'admin') return all;
  const assigned = access.departments ?? [];
  if (assigned.length === 0) return all;
  const mine = all.filter((d) => assigned.includes(d));
  return mine.length > 0 ? mine : all;
}

/** More than one department to choose from: only then is the department switch shown. */
export function canSwitchDepartment(visible: readonly Department[]): boolean {
  return visible.length > 1;
}

/** The department to open: the remembered one when the person can still open it, else the first they can. */
export function resolveDepartment(visible: readonly Department[], remembered: string | null | undefined): Department {
  return visible.find((d) => d === remembered) ?? visible[0] ?? 'clinic';
}

/** The department a visit, appointment or advance belongs to (no place = OP). */
export function departmentOf(record: { location?: string | null } | null | undefined): Department {
  return locationOf(record);
}

/** True when a record belongs to the department. */
export function inDepartment(department: Department, record: { location?: string | null } | null | undefined): boolean {
  return departmentOf(record) === department;
}

/** The roster people who can be booked in a department: everyone with no restriction, else those who work there. */
export function therapistsInDepartment<T extends { careLocations?: readonly string[] | null }>(
  department: Department,
  therapists: readonly T[]
): T[] {
  return therapists.filter((t) => !t.careLocations || t.careLocations.length === 0 || t.careLocations.includes(department));
}
