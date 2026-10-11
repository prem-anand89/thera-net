import { therapistUtilisation, type Utilisation } from './utilisation';
import type { UtilisationBucket } from './utilisationPeriods';
import type { Visit, WorkingHours } from './types';

export type ReportTherapist = {
  id: string;
  name: string;
  active: boolean;
  workingHours?: WorkingHours | null;
};

export type TherapistBucketRow = {
  therapistId: string;
  name: string;
  utilisation: Utilisation;
  /** Visits this therapist was the primary therapist on in the period. */
  visitCount: number;
};

export type BucketReport = {
  bucket: UtilisationBucket;
  /** Clinic-wide: total work done / total available time across included therapists. */
  clinicRatio: number | null;
  rows: TherapistBucketRow[];
};

type ReportVisit = Pick<Visit, 'therapistId' | 'visitDate' | 'sharedTherapistId' | 'sharedPct'>;

/**
 * Utilisation per period for the whole clinic and each therapist. A period
 * includes every active therapist plus any inactive one who logged work in it,
 * so a departed therapist's history isn't dropped from past periods.
 */
export function clinicUtilisationReport(input: {
  buckets: UtilisationBucket[];
  therapists: ReportTherapist[];
  visits: ReportVisit[];
  clinicHours: { startHour: number; endHour: number };
  closedWeekdays?: number[];
  closedDates: { closedDate: string; label: string | null }[];
  slotMinutes: number;
  asOf: { date: string; minutes: number };
}): BucketReport[] {
  return input.buckets.map((bucket) => {
    const inRange = input.visits.filter((v) => v.visitDate >= bucket.from && v.visitDate <= bucket.to);
    const worked = new Set<string>();
    for (const v of inRange) {
      worked.add(v.therapistId);
      if (v.sharedTherapistId) worked.add(v.sharedTherapistId);
    }
    const rows = input.therapists
      .filter((t) => t.active || worked.has(t.id))
      .map((t): TherapistBucketRow => ({
        therapistId: t.id,
        name: t.name,
        visitCount: inRange.filter((v) => v.therapistId === t.id).length,
        utilisation: therapistUtilisation({
          visits: inRange,
          therapistId: t.id,
          workingHours: t.workingHours,
          from: bucket.from,
          to: bucket.to,
          clinicHours: input.clinicHours,
          closedWeekdays: input.closedWeekdays,
          closedDates: input.closedDates,
          slotMinutes: input.slotMinutes,
          asOf: input.asOf,
        }),
      }));
    const available = rows.reduce((s, r) => s + r.utilisation.availableMinutes, 0);
    const done = rows.reduce((s, r) => s + r.utilisation.workedMinutes, 0);
    return { bucket, clinicRatio: available > 0 ? done / available : null, rows };
  });
}
