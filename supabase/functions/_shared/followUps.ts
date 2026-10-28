/**
 * Which follow-up reviews belong in a therapist's evening agenda. Pure (no database, no clock), so it is tested
 * without Supabase. The rules mirror src/domain/followUp.ts in the app and are checked against it by a parity test
 * (src/domain/followUpAgendaParity.test.ts): keep the two in step.
 */

export interface AgendaFollowUpPatient {
  id: string;
  name: string;
  phone: string | null;
  followUpOn: string; // YYYY-MM-DD
  followUpSetOn: string | null;
  followUpNote: string | null;
  followUpTherapistId: string | null;
}
export interface AgendaFollowUpVisit {
  patientId: string;
  visitDate: string;
}
export interface AgendaFollowUpAppointment {
  patientId: string | null;
  patientPhone: string;
  scheduledAtMs: number;
  status: string;
}

/** The email lists reviews due up to this many days before the agenda's day; after that they are "missed" and reminders stop. */
export const AGENDA_OVERDUE_DAYS = 7;
const FULFILLING = ['confirmed', 'rescheduled', 'arrived'];
const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Patients whose review is due on or before `forDate` (the agenda's day), at most 7 days overdue by then, and not
 * fulfilled: no visit on a later day than the one it was set, and no confirmed / rescheduled / arrived appointment
 * from the next day on (`dayStartMs` gives the clinic-local start of a day). A cancelled or no-show appointment
 * does not fulfil it. Oldest due date first.
 */
export function agendaFollowUps(input: {
  patients: AgendaFollowUpPatient[];
  visits: AgendaFollowUpVisit[];
  appointments: AgendaFollowUpAppointment[];
  forDate: string;
  dayStartMs: (ymd: string) => number;
}): AgendaFollowUpPatient[] {
  const earliest = addDays(input.forDate, -AGENDA_OVERDUE_DAYS);
  return input.patients
    .filter((p) => p.followUpOn <= input.forDate && p.followUpOn >= earliest)
    .filter((p) => {
      const setOn = p.followUpSetOn;
      if (!setOn) return true;
      if (input.visits.some((v) => v.patientId === p.id && v.visitDate > setOn)) return false;
      const from = input.dayStartMs(addDays(setOn, 1));
      const phone = digits(p.phone);
      return !input.appointments.some(
        (a) =>
          FULFILLING.includes(a.status) &&
          a.scheduledAtMs >= from &&
          (a.patientId ? a.patientId === p.id : phone !== '' && digits(a.patientPhone) === phone)
      );
    })
    .sort((a, b) => a.followUpOn.localeCompare(b.followUpOn));
}
