import { therapistUtilisation, type Utilisation } from './utilisation';
import type { UtilisationBucket } from './utilisationPeriods';
import type { Visit, WorkingHours } from './types';

export type ReportTherapist = {
  id: string;
  name: string;
  active: boolean;
  workingHours?: WorkingHours | null;
  photoPath?: string | null;
};

export type TherapistBucketRow = {
  therapistId: string;
  name: string;
  photoPath?: string | null;
  utilisation: Utilisation;
  /** Visits this therapist was the primary therapist on in the period. */
  visitCount: number;
  /** Total billed revenue in paise attributed to this therapist in the period. */
  revenuePaise: number;
};

export type BucketReport = {
  bucket: UtilisationBucket;
  /** Clinic-wide: total work done / total available time across included therapists. */
  clinicRatio: number | null;
  /** Clinic-wide: total billed revenue in paise in the bucket. */
  clinicRevenuePaise: number;
  /** Prior bucket clinic utilisation ratio (for period-over-period comparison). */
  priorClinicRatio: number | null;
  /** Prior bucket clinic revenue in paise (for period-over-period comparison). */
  priorClinicRevenuePaise: number | null;
  rows: TherapistBucketRow[];
};

type ReportVisit = Pick<Visit, 'therapistId' | 'visitDate' | 'sharedTherapistId' | 'sharedPct'> & {
  actualBillPaise?: number;
};

/**
 * Utilisation and revenue per period for the whole clinic and each therapist. A period
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
  const reportsWithoutPrior = input.buckets.map((bucket) => {
    const inRange = input.visits.filter((v) => v.visitDate >= bucket.from && v.visitDate <= bucket.to);
    const worked = new Set<string>();
    for (const v of inRange) {
      worked.add(v.therapistId);
      if (v.sharedTherapistId) worked.add(v.sharedTherapistId);
    }
    const rows = input.therapists
      .filter((t) => t.active || worked.has(t.id))
      .map((t): TherapistBucketRow => {
        const therapistVisits = inRange.filter((v) => v.therapistId === t.id);
        const revenuePaise = therapistVisits.reduce((sum, v) => sum + (v.actualBillPaise ?? 0), 0);
        return {
          therapistId: t.id,
          name: t.name,
          photoPath: t.photoPath,
          visitCount: therapistVisits.length,
          revenuePaise,
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
        };
      });
    const available = rows.reduce((s, r) => s + r.utilisation.availableMinutes, 0);
    const done = rows.reduce((s, r) => s + r.utilisation.workedMinutes, 0);
    const clinicRatio = available > 0 ? done / available : null;
    const clinicRevenuePaise = inRange.reduce((sum, v) => sum + (v.actualBillPaise ?? 0), 0);

    return {
      bucket,
      clinicRatio,
      clinicRevenuePaise,
      rows,
    };
  });

  return reportsWithoutPrior.map((report, i) => {
    const prior = i > 0 ? reportsWithoutPrior[i - 1] : null;
    return {
      ...report,
      priorClinicRatio: prior ? prior.clinicRatio : null,
      priorClinicRevenuePaise: prior ? prior.clinicRevenuePaise : null,
    };
  });
}
