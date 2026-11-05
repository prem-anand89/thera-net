import type { UUID, Visit } from './types';

export interface OpenPackageGroup {
  packageGroupId: UUID;
  patientId: UUID;
  serviceCatalogId: UUID;
  sessionsLogged: number;
  packageTotal: number;
  /** Earliest visit date in the group */
  startedOn: string;
  /** Latest visit date in the group — the anchor for staleness */
  lastVisitOn: string;
  /** The latest visit's own id — lets a caller jump straight into logging
   *  the next session via the same repeatVisitId mechanism Ledger's "Repeat"
   *  action already uses. */
  lastVisitId: UUID;
  /** Therapist who logged the earliest (session 1) visit — who "started" this package. */
  startedByTherapistId: UUID;
  /** Last valid day (ISO date), or null when the package doesn't expire. */
  expiresOn: string | null;
}

/**
 * Groups a clinic-wide visit list by packageGroupId, keeping only packages
 * still short of their session count. Generalizes the per-patient
 * `openPackages` query in NewVisitPage.tsx to the whole clinic, and — unlike
 * that version — also tracks the latest visit date, since staleness needs it.
 */
export function groupOpenPackages(visits: Visit[]): OpenPackageGroup[] {
  const groups = new Map<UUID, Visit[]>();
  for (const v of visits) {
    if (v.deleted || !v.packageGroupId) continue;
    if (!groups.has(v.packageGroupId)) groups.set(v.packageGroupId, []);
    groups.get(v.packageGroupId)!.push(v);
  }

  const open: OpenPackageGroup[] = [];
  for (const [packageGroupId, group] of groups) {
    const packageTotal = group[0].packageTotal ?? 1;
    if (group.length >= packageTotal) continue;
    const sorted = [...group].sort((a, b) => a.visitDate.localeCompare(b.visitDate));
    open.push({
      packageGroupId,
      patientId: group[0].patientId,
      serviceCatalogId: group[0].serviceCatalogId,
      sessionsLogged: group.length,
      packageTotal,
      startedOn: sorted[0].visitDate,
      lastVisitOn: sorted[sorted.length - 1].visitDate,
      lastVisitId: sorted[sorted.length - 1].id,
      startedByTherapistId: sorted[0].therapistId,
      expiresOn: packageExpiresOn(group),
    });
  }
  return open;
}

/** Whole days between an ISO date string and a reference point (today by default). */
export function daysSince(dateStr: string, asOf: Date | string = new Date()): number {
  const from = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  const to = typeof asOf === 'string' ? new Date(`${asOf.slice(0, 10)}T00:00:00`) : asOf;
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

type PackageSession = Pick<Visit, 'visitDate' | 'packageValidityDays' | 'deleted'>;

/** The days a package is valid for: any live session carries them, so deleting the first visit doesn't lose them. */
export function packageValidityOf(group: PackageSession[]): number | null {
  return group.find((v) => !v.deleted && v.packageValidityDays != null)?.packageValidityDays ?? null;
}

/**
 * A package's last valid day: its first live visit's date + the validity days. Worked out on read, never stored,
 * so correcting that visit's date moves it. Null = it doesn't expire.
 */
export function packageExpiresOn(group: PackageSession[]): string | null {
  const days = packageValidityOf(group);
  if (days == null) return null;
  const first = group
    .filter((v) => !v.deleted)
    .map((v) => v.visitDate.slice(0, 10))
    .sort()[0];
  const [y, m, d] = first.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Within this many days of the last valid day, a package reads "Expiring soon". */
export const EXPIRING_SOON_DAYS = 7;

export type PackageExpiryState = 'expired' | 'expiring' | null;

/** Today on this device as an ISO date (not UTC: an evening in India is still today). */
export function localToday(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/** The last valid day still counts as valid. `asOf` is an ISO date (today, or the date of the visit being logged). */
export function packageExpiryState(expiresOn: string | null | undefined, asOf: string = localToday()): PackageExpiryState {
  if (!expiresOn) return null;
  const left = daysSince(asOf, expiresOn);
  if (left < 0) return 'expired';
  return left <= EXPIRING_SOON_DAYS ? 'expiring' : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Dec", for package expiry wording. */
export function formatExpiryDate(isoDate: string): string {
  const [, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export const STALE_PACKAGE_DAYS = 14;

export function isStale(
  lastVisitDate: string,
  asOf: Date | string = new Date(),
  thresholdDays: number = STALE_PACKAGE_DAYS
): boolean {
  return daysSince(lastVisitDate, asOf) > thresholdDays;
}

/** Sessions left before a package is fully used up. */
export function sessionsRemaining(sessionsLogged: number, packageTotal: number): number {
  return Math.max(0, packageTotal - sessionsLogged);
}

/** 2 or fewer sessions left — the point where staff should raise renewal
 *  before the patient runs out, rather than after (that's `isStale`'s job). */
export const NEARING_COMPLETION_REMAINING = 2;

export function isNearingCompletion(sessionsLogged: number, packageTotal: number): boolean {
  const remaining = sessionsRemaining(sessionsLogged, packageTotal);
  return remaining > 0 && remaining <= NEARING_COMPLETION_REMAINING;
}
