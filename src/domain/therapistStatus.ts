import { MIN_VISITS_FOR_RANKING } from './therapistRanking';

export type TherapistStatus = 'strong' | 'steady' | 'attention' | 'insufficient';

/** Defaults an admin can read at a glance; kept as named constants, not hidden in logic. */
export const STATUS_THRESHOLDS = {
  /** At or above this (and not below the clinic) = strong. */
  strongAt: 0.7,
  /** Below this = needs attention regardless of the clinic. */
  lowBelow: 0.5,
  /** This far under the clinic's utilisation = needs attention. */
  gapBelowClinic: 0.15,
  /** A fall of this much vs the previous period (while under the clinic) = needs attention. */
  dropFromPrevious: 0.1,
} as const;

export function therapistStatus(input: {
  utilisation: number | null;
  clinicUtilisation: number | null;
  previousUtilisation: number | null;
  patientsTreated: number;
}): { status: TherapistStatus; reason: string } {
  const { utilisation: u, clinicUtilisation: c, previousUtilisation: p, patientsTreated } = input;
  const t = STATUS_THRESHOLDS;
  if (u == null || patientsTreated < MIN_VISITS_FOR_RANKING) {
    return { status: 'insufficient', reason: `Fewer than ${MIN_VISITS_FOR_RANKING} patients treated, or no available hours` };
  }
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (u < t.lowBelow) return { status: 'attention', reason: `Utilisation ${pct(u)} is below ${pct(t.lowBelow)}` };
  if (c != null && u < c - t.gapBelowClinic) {
    return { status: 'attention', reason: `${pct(c - u)} points under the clinic's ${pct(c)}` };
  }
  if (p != null && c != null && u <= p - t.dropFromPrevious && u < c) {
    return { status: 'attention', reason: `Down from ${pct(p)} last period` };
  }
  if (u >= t.strongAt && (c == null || u >= c)) {
    return { status: 'strong', reason: `${pct(u)}, at or above the clinic` };
  }
  return { status: 'steady', reason: `${pct(u)}` };
}
