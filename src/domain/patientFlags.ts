import type { Appointment } from './types';

/**
 * Small at-a-glance facts about the patient behind an appointment — shown as
 * pills on Today rows, the phone agenda, History and the details panel. Each
 * one changes what staff do next: welcome a new patient properly, mention the
 * package, collect a balance, or send an extra reminder.
 */
export type PatientFlag =
  | { key: 'new'; label: string }
  | { key: 'package'; label: string }
  | { key: 'balance'; label: string }
  | { key: 'noshow'; label: string; count: number };

export interface PatientFlagContext {
  /** Patients with at least one (non-deleted) visit. */
  patientIdsWithVisits: Set<string>;
  /** Open package per patient: sessions logged so far / package total. */
  packages: Map<string, { logged: number; total: number }>;
  /** Patients with an outstanding invoice. */
  balanceDue: Set<string>;
  /** No-shows per patient key (`patientKey`). */
  noShows: Map<string, number>;
  /** Short clinical reason per patient: primary condition, else the latest visit's condition. */
  conditionByPatient: Map<string, string>;
  /** Patient-written notes from public booking requests, by request id. */
  requestNotes: Map<string, string>;
}

/** Patients may be unlinked (public requests): fall back to the last 10 phone digits. */
export function patientKey(appointment: Pick<Appointment, 'patientId' | 'patientPhone'>): string {
  return appointment.patientId ?? `phone:${appointment.patientPhone.replace(/\D/g, '').slice(-10)}`;
}

export const NO_SHOW_FLAG_AT = 2;

export function patientFlags(appointment: Appointment, ctx: PatientFlagContext | undefined): PatientFlag[] {
  if (!ctx) return [];
  const flags: PatientFlag[] = [];
  const id = appointment.patientId;
  if (!id || !ctx.patientIdsWithVisits.has(id)) flags.push({ key: 'new', label: 'New patient' });
  const pkg = id ? ctx.packages.get(id) : undefined;
  if (pkg) {
    // The session this appointment would be (or was, once its visit is logged).
    const session = appointment.visitId ? pkg.logged : Math.min(pkg.logged + 1, pkg.total);
    flags.push({ key: 'package', label: `Package ${session}/${pkg.total}` });
  }
  if (id && ctx.balanceDue.has(id)) flags.push({ key: 'balance', label: 'Balance due' });
  const noShows = ctx.noShows.get(patientKey(appointment)) ?? 0;
  if (noShows >= NO_SHOW_FLAG_AT) flags.push({ key: 'noshow', label: `${noShows} no-shows`, count: noShows });
  return flags;
}

/**
 * Why the patient is coming, in a few words: the clinical condition on file
 * (primary condition, else the latest visit's), else what the patient wrote
 * when booking online — labelled as theirs, since it isn't a diagnosis.
 */
export function appointmentReason(
  appointment: Appointment,
  ctx: PatientFlagContext | undefined
): { text: string; fromPatient: boolean } | null {
  if (!ctx) return null;
  const condition = appointment.patientId ? ctx.conditionByPatient.get(appointment.patientId) : undefined;
  if (condition) return { text: condition, fromPatient: false };
  const note = appointment.requestId ? ctx.requestNotes.get(appointment.requestId) : undefined;
  if (note) return { text: `Patient says: ${note}`, fromPatient: true };
  return null;
}

/** Counts no-shows per patient key across a list of appointments. */
export function countNoShows(appointments: Appointment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of appointments) {
    if (a.status !== 'no_show') continue;
    const key = patientKey(a);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
