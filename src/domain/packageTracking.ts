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

export const STALE_PACKAGE_DAYS = 14;

export function isStale(
  lastVisitDate: string,
  asOf: Date | string = new Date(),
  thresholdDays: number = STALE_PACKAGE_DAYS
): boolean {
  return daysSince(lastVisitDate, asOf) > thresholdDays;
}
