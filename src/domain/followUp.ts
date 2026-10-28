import { addDays } from '@/domain/schedule';
import type { Appointment, Patient, Visit } from '@/domain/types';

/** Reminders (the agenda email) start this many days before the due date. */
export const FOLLOW_UP_DUE_SOON_DAYS = 3;
/** Reminders stop this many days after the due date; the follow-up then becomes "missed". */
export const FOLLOW_UP_REMIND_UNTIL_DAYS = 7;
/** A missed follow-up stays on the Workspace list this long after its due date, then drops off (it stays on the profile). */
export const FOLLOW_UP_MISSED_VISIBLE_DAYS = 30;
/** A no-show appointment counts as "to rebook" for this many days. */
export const NO_SHOW_LOOKBACK_DAYS = 14;

export type FollowUpPreset = '2d' | '3d' | '1w';
export const FOLLOW_UP_PRESETS: { key: FollowUpPreset; label: string; days: number }[] = [
  { key: '2d', label: '2 days', days: 2 },
  { key: '3d', label: '3 days', days: 3 },
  { key: '1w', label: '1 week', days: 7 },
];

/** The target date for a preset, counted from the day it is set. */
export function followUpDateFor(preset: FollowUpPreset, from: string): string {
  const days = FOLLOW_UP_PRESETS.find((p) => p.key === preset)!.days;
  return addDays(from, days);
}

export type FollowUpState =
  | 'none'
  | 'planned' // set, more than 3 days away
  | 'due_soon' // 1-3 days away
  | 'due' // today
  | 'overdue' // 1-7 days past: still being reminded
  | 'missed' // 8-30 days past: reminders stopped, still on the Workspace list
  | 'expired' // more than 30 days past: profile only
  | 'done'; // fulfilled by a later visit or appointment

const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

function dayDiff(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** An appointment belongs to the patient by id, or by phone when it was never linked to a patient row. */
export function appointmentIsFor(appointment: Appointment, patient: Pick<Patient, 'id' | 'phone'>): boolean {
  if (appointment.patientId) return appointment.patientId === patient.id;
  const phone = digits(patient.phone);
  return phone !== '' && digits(appointment.patientPhone) === phone;
}

const FULFILLING_STATUSES: Appointment['status'][] = ['confirmed', 'rescheduled', 'arrived'];

/**
 * Whether the patient came (or is booked to come) after the day the follow-up was set. Strictly later, so the
 * visit that prompted it and any other visit that same day never clear it; a cancelled or no-show appointment
 * does not count, so a missed review comes back on the list by itself.
 */
export function followUpFulfilled(
  patient: Patient,
  visits: Visit[],
  appointments: Appointment[]
): boolean {
  const setOn = patient.followUpSetOn;
  if (!setOn) return false;
  const visited = visits.some((v) => !v.deleted && v.patientId === patient.id && v.visitDate > setOn);
  if (visited) return true;
  return appointments.some(
    (a) =>
      FULFILLING_STATUSES.includes(a.status) &&
      appointmentIsFor(a, patient) &&
      new Date(a.scheduledAt).getTime() >= new Date(`${addDays(setOn, 1)}T00:00:00`).getTime()
  );
}

export function followUpState(
  patient: Patient,
  visits: Visit[],
  appointments: Appointment[],
  today: string
): { state: FollowUpState; daysFromDue: number } {
  const due = patient.followUpOn;
  if (!due) return { state: 'none', daysFromDue: 0 };
  const daysFromDue = dayDiff(today, due); // positive = still ahead, negative = overdue
  if (followUpFulfilled(patient, visits, appointments)) return { state: 'done', daysFromDue };
  if (daysFromDue > FOLLOW_UP_DUE_SOON_DAYS) return { state: 'planned', daysFromDue };
  if (daysFromDue > 0) return { state: 'due_soon', daysFromDue };
  if (daysFromDue === 0) return { state: 'due', daysFromDue };
  const overdue = -daysFromDue;
  if (overdue <= FOLLOW_UP_REMIND_UNTIL_DAYS) return { state: 'overdue', daysFromDue };
  if (overdue <= FOLLOW_UP_MISSED_VISIBLE_DAYS) return { state: 'missed', daysFromDue };
  return { state: 'expired', daysFromDue };
}

export type FollowUpRow = { patient: Patient; dueOn: string; daysFromDue: number };

/**
 * The Workspace lists. `due` is everything being acted on now (due soon, today, overdue), soonest first;
 * `missed` is past the reminder window but still listed, most recent first. A therapist passes their id to see only theirs.
 */
export function followUpLists(
  patients: Patient[],
  visits: Visit[],
  appointments: Appointment[],
  today: string,
  options: { therapistId?: string | null } = {}
): { due: FollowUpRow[]; missed: FollowUpRow[] } {
  const due: FollowUpRow[] = [];
  const missed: FollowUpRow[] = [];
  for (const patient of patients) {
    if (patient.deletedAt || !patient.followUpOn) continue;
    if (options.therapistId && patient.followUpTherapistId !== options.therapistId) continue;
    const { state, daysFromDue } = followUpState(patient, visits, appointments, today);
    const row = { patient, dueOn: patient.followUpOn, daysFromDue };
    if (state === 'due_soon' || state === 'due' || state === 'overdue') due.push(row);
    else if (state === 'missed') missed.push(row);
  }
  due.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  missed.sort((a, b) => b.dueOn.localeCompare(a.dueOn));
  return { due, missed };
}

export type NoShowRow = { appointment: Appointment; patient: Patient | null };

/**
 * Appointments marked no-show in the last 14 days where the patient has no later booked appointment or visit:
 * people who were meant to come and did not, and have not been rebooked. Newest first, one row per patient.
 */
export function noShowsToRebook(
  appointments: Appointment[],
  visits: Visit[],
  patients: Patient[],
  today: string,
  options: { therapistId?: string | null } = {}
): NoShowRow[] {
  const since = new Date(`${addDays(today, -NO_SHOW_LOOKBACK_DAYS)}T00:00:00`).getTime();
  const byId = new Map(patients.map((p) => [p.id, p]));
  const rows: NoShowRow[] = [];
  const seen = new Set<string>();
  const missed = appointments
    .filter((a) => a.status === 'no_show' && new Date(a.scheduledAt).getTime() >= since)
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  for (const appointment of missed) {
    if (options.therapistId && appointment.therapistId !== options.therapistId) continue;
    const patient = appointment.patientId ? byId.get(appointment.patientId) ?? null : null;
    const key = appointment.patientId ?? digits(appointment.patientPhone);
    if (!key || seen.has(key)) continue;
    const noShowAt = new Date(appointment.scheduledAt).getTime();
    const rebooked =
      appointments.some(
        (a) =>
          a.id !== appointment.id &&
          FULFILLING_STATUSES.includes(a.status) &&
          new Date(a.scheduledAt).getTime() > noShowAt &&
          (appointment.patientId ? a.patientId === appointment.patientId : appointmentIsFor(a, { id: '', phone: appointment.patientPhone }))
      ) ||
      (appointment.patientId !== null &&
        visits.some((v) => !v.deleted && v.patientId === appointment.patientId && new Date(`${v.visitDate}T23:59:59`).getTime() > noShowAt));
    if (rebooked) continue;
    seen.add(key);
    rows.push({ appointment, patient });
  }
  return rows;
}
