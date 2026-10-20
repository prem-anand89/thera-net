import type { UUID, WorkingHours } from '@/domain/types';
import type { TimeOfDay } from '@/domain/waitlistMatch';
import { getSupabase } from '@/lib/supabase';
import { openPatientWhatsAppChat } from '@/lib/pdfShare';
import {
  whenLabel,
  patientMessage,
  therapistMessage,
  type PatientMessageKind,
  type TherapistMessageKind,
} from '@/domain/bookingMessages';
import { syncEngine } from '@/sync/engine';
import { enqueueAppointmentLink } from '@/sync/pendingLinks';

/**
 * Patient Communications, Slice 5: public booking requests → confirmed
 * appointments. Every function here is a thin RPC wrapper — nothing in
 * this module writes Dexie/outbox directly, matching the "every write is
 * online-only" rule the handoff doc states for the whole booking
 * workflow (see `src/lib/db.ts`'s comment on why `appointment_requests`/
 * `appointments` are read-only-synced tables). Public (anonymous) calls
 * and staff calls share this one file rather than being split, mirroring
 * `feedbackService.ts`'s single-file-per-workflow shape.
 *
 * Because these two tables carry no outbox, nothing nudges `syncEngine`
 * the way a normal Dexie write does — without an explicit kick, the
 * Requests → Bookings lists (and Workspace's "Expected today") would sit
 * stale on whatever the *last* periodic pull saw (up to 5 minutes old)
 * after every staff mutation below, even though the action itself
 * succeeded. `feedbackService.ts` solves the equivalent problem for
 * `feedback_requests` by writing the RPC's returned row straight into
 * Dexie; most of these RPCs return only void or a bare id, not a full
 * row, so the simpler fix here is `syncEngine.schedule(0)` — the same
 * near-immediate pull the manual "Sync now" button and post-clinic-create
 * refresh already use — right after each successful staff mutation.
 */

/** The series RPC lists clashing starts as UTC ISO times; show them locally. */
function localiseIsoTimes(message: string): string {
  return message.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z/g, (iso) => whenLabel(iso));
}

function supabaseOrThrow() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured');
  if (!navigator.onLine) {
    throw new Error('This needs a connection — reconnect and try again.');
  }
  return supabase;
}

export const bookingService = {
  // ---- Public (anonymous, /book/$slug) ----------------------------------

  /** Validates the slug and the module flag; throws the RPC's own generic
   *  "not available" message otherwise. */
  async getBookingClinicInfo(slug: string): Promise<{ name: string; logoPath: string | null; slotDurationMinutes: number; bookingStartHour: number; bookingEndHour: number; timezone?: string }> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.rpc('get_booking_clinic_info', { p_slug: slug });
    if (error) throw new Error(error.message);
    return data as { name: string; logoPath: string | null; slotDurationMinutes: number; bookingStartHour: number; bookingEndHour: number; timezone?: string };
  },

  async listBookingTherapists(slug: string): Promise<{ id: UUID; name: string }[]> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.rpc('list_booking_therapists', { p_slug: slug });
    if (error) throw new Error(error.message);
    return (data as { id: UUID; name: string }[] | null) ?? [];
  },

  async getBookingAvailability(slug: string, startDate: string, endDate: string): Promise<{ closedWeekdays: number[], closedDates: { date: string, label: string }[], appointments: { scheduled_at: string, therapist_id: UUID, duration_minutes?: number }[], therapistHours?: Record<string, WorkingHours> }> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.rpc('get_booking_availability', { 
      p_slug: slug,
      p_start_date: startDate,
      p_end_date: endDate
    });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data as any;
  },

  async submitAppointmentRequest(
    slug: string,
    name: string,
    phone: string,
    email: string | null,
    preferredTherapistId: UUID | null,
    notes: string | null,
    preferredDate: string | null,
    preferredTimeText: string | null,
    preferredTimeOfDay?: TimeOfDay | 'any' | null,
    isWaitlist?: boolean
  ): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.rpc('submit_appointment_request', {
      p_slug: slug,
      p_name: name,
      p_phone: phone,
      p_email: email,
      p_preferred_therapist_id: preferredTherapistId,
      p_notes: notes,
      p_preferred_date: preferredDate,
      p_preferred_time_text: preferredTimeText,
      p_preferred_time_of_day: preferredTimeOfDay ?? null,
      p_is_waitlist: isWaitlist ?? false,
    });
    if (error) throw new Error(error.message);
  },

  /** Staff-entered waitlist join (e.g. a phone call-in) — same shape as
   *  `submitAppointmentRequest`, without the public booking-slug lookup. */
  async addWaitlistEntry(params: {
    clinicId: UUID;
    name: string;
    phone: string;
    email: string | null;
    preferredTherapistId: UUID | null;
    notes: string | null;
    preferredDate: string | null;
    preferredTimeOfDay?: TimeOfDay | 'any' | null;
  }): Promise<UUID> {
    const supabase = supabaseOrThrow();
    const { data, error } = await supabase.rpc('add_waitlist_entry', {
      p_clinic_id: params.clinicId,
      p_name: params.name,
      p_phone: params.phone,
      p_email: params.email,
      p_preferred_therapist_id: params.preferredTherapistId,
      p_notes: params.notes,
      p_preferred_date: params.preferredDate,
      p_preferred_time_of_day: params.preferredTimeOfDay ?? null,
    });
    if (error) throw new Error(error.message);
    return data as UUID;
  },

  // ---- Staff (Requests → Bookings, Workspace "Expected today") ----------

  async confirmBookingSlot(params: {
    clinicId: UUID;
    patientId: UUID | null;
    patientName: string;
    patientPhone: string;
    therapistId: UUID;
    scheduledAt: string;
    requestId: UUID | null;
    /** Omit to use the clinic's slot length. */
    durationMinutes?: number;
  }): Promise<UUID> {
    const supabase = supabaseOrThrow();
    const { data, error } = await supabase.rpc('confirm_booking_slot', {
      p_clinic_id: params.clinicId,
      p_patient_id: params.patientId,
      p_name: params.patientName,
      p_phone: params.patientPhone,
      p_therapist_id: params.therapistId,
      p_scheduled_at: params.scheduledAt,
      p_request_id: params.requestId,
      p_duration_minutes: params.durationMinutes ?? null,
    });
    if (error) throw new Error(`Could not confirm booking: ${error.message}`);
    syncEngine.schedule(0);
    return data as UUID;
  },

  /** Books several sessions at once; all-or-nothing. Returns the series id. */
  async confirmBookingSeries(params: {
    clinicId: UUID;
    patientId: UUID | null;
    patientName: string;
    patientPhone: string;
    therapistId: UUID;
    starts: string[];
    durationMinutes: number;
  }): Promise<UUID> {
    const supabase = supabaseOrThrow();
    const { data, error } = await supabase.rpc('confirm_booking_series', {
      p_clinic_id: params.clinicId,
      p_name: params.patientName,
      p_phone: params.patientPhone,
      p_therapist_id: params.therapistId,
      p_starts: params.starts,
      p_patient_id: params.patientId,
      p_duration_minutes: params.durationMinutes,
    });
    if (error) throw new Error(`Could not book the sessions: ${localiseIsoTimes(error.message)}`);
    syncEngine.schedule(0);
    return data as UUID;
  },

  /** Cancels this session and every later open session of its series. */
  async cancelAppointmentSeries(seriesId: UUID, fromScheduledAt: string): Promise<number> {
    const supabase = supabaseOrThrow();
    const { data, error } = await supabase.rpc('cancel_appointment_series', {
      p_series_id: seriesId,
      p_from: fromScheduledAt,
    });
    if (error) throw new Error(`Could not cancel the sessions: ${error.message}`);
    syncEngine.schedule(0);
    return (data as number) ?? 0;
  },

  /** Starts a walk-in: an arrived appointment now, no visit yet (service and
   *  payment come later via New Visit). No overlap check — they're here. */
  async startWalkIn(input: {
    clinicId: UUID;
    therapistId: UUID;
    patientName: string;
    patientPhone: string | null;
    patientId: UUID | null;
  }): Promise<UUID> {
    const supabase = supabaseOrThrow();
    const { data, error } = await supabase.rpc('start_walk_in', {
      p_clinic_id: input.clinicId,
      p_therapist_id: input.therapistId,
      p_name: input.patientName,
      p_phone: input.patientPhone,
      p_patient_id: input.patientId,
    });
    if (error) throw new Error(`Could not start the visit: ${error.message}`);
    syncEngine.schedule(0);
    return data as UUID;
  },

  async declineAppointmentRequest(requestId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('decline_appointment_request', {
      p_request_id: requestId,
    });
    if (error) throw new Error(`Could not decline: ${error.message}`);
    syncEngine.schedule(0);
  },

  /** Moves and/or resizes an appointment; `therapistId` reassigns it
   *  (admin / front desk only — the RPC checks both therapists). */
  async rescheduleAppointment(
    appointmentId: UUID,
    newScheduledAt: string,
    durationMinutes?: number,
    therapistId?: UUID
  ): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('reschedule_appointment', {
      p_appointment_id: appointmentId,
      p_new_scheduled_at: newScheduledAt,
      p_duration_minutes: durationMinutes ?? null,
      p_therapist_id: therapistId ?? null,
    });
    if (error) throw new Error(`Could not reschedule: ${error.message}`);
    syncEngine.schedule(0);
  },

  /** Undo of a calendar drag: puts the appointment's previous slot,
   *  therapist (including Unassigned), status and reschedule history back,
   *  instead of counting the undo as another reschedule. */
  async restoreAppointmentSlot(previous: {
    id: UUID;
    scheduledAt: string;
    durationMinutes: number;
    therapistId: UUID | null;
    status: 'confirmed' | 'rescheduled';
    rescheduleCount: number;
    previousScheduledAt: string | null;
  }): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('restore_appointment_slot', {
      p_appointment_id: previous.id,
      p_scheduled_at: previous.scheduledAt,
      p_duration_minutes: previous.durationMinutes,
      p_therapist_id: previous.therapistId,
      p_status: previous.status,
      p_reschedule_count: previous.rescheduleCount,
      p_previous_scheduled_at: previous.previousScheduledAt,
    });
    if (error) throw new Error(`Could not undo: ${error.message}`);
    syncEngine.schedule(0);
  },

  async markAppointmentNoShow(appointmentId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('mark_appointment_no_show', {
      p_appointment_id: appointmentId,
    });
    if (error) throw new Error(`Could not update: ${error.message}`);
    syncEngine.schedule(0);
  },

  /** Puts a no-show back to confirmed (or rescheduled if it had been moved). The slot is still held, so it cannot clash. */
  async restoreNoShowAppointment(appointmentId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('restore_no_show_appointment', {
      p_appointment_id: appointmentId,
    });
    if (error) throw new Error(`Could not undo the no-show: ${error.message}`);
    syncEngine.schedule(0);
  },

  /** Brings a cancelled appointment back. The server re-checks the slot and refuses if it was booked since. */
  async restoreCancelledAppointment(appointmentId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('restore_cancelled_appointment', {
      p_appointment_id: appointmentId,
    });
    if (error) throw new Error(`Could not restore the appointment: ${error.message}`);
    syncEngine.schedule(0);
  },

  async cancelAppointment(appointmentId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('cancel_appointment', {
      p_appointment_id: appointmentId,
    });
    if (error) throw new Error(`Could not cancel: ${error.message}`);
    syncEngine.schedule(0);
  },

  /** Saves a therapist's weekly hours (null = back to clinic hours). */
  async setWorkingHours(therapistId: UUID, hours: WorkingHours | null): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('set_therapist_working_hours', {
      p_therapist_id: therapistId,
      p_hours: hours,
    });
    if (error) throw new Error(`Could not save working hours: ${error.message}`);
    syncEngine.schedule(0);
  },

  async createShiftTemplate(params: {
    clinicId: UUID;
    name: string;
    startMinute: number;
    endMinute: number;
    breakDurationMinutes?: number;
    defaultBreakStartMinute?: number | null;
  }): Promise<UUID> {
    const supabase = supabaseOrThrow();
    const { data, error } = await supabase.rpc('create_shift_template', {
      p_clinic_id: params.clinicId,
      p_name: params.name,
      p_start_minute: params.startMinute,
      p_end_minute: params.endMinute,
      p_break_duration_minutes: params.breakDurationMinutes ?? 0,
      p_default_break_start_minute: params.defaultBreakStartMinute ?? null,
    });
    if (error) throw new Error(`Could not create shift template: ${error.message}`);
    syncEngine.schedule(0);
    return data as UUID;
  },

  async updateShiftTemplate(params: {
    templateId: UUID;
    name: string;
    startMinute: number;
    endMinute: number;
    breakDurationMinutes: number;
    defaultBreakStartMinute: number | null;
    active: boolean;
  }): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('update_shift_template', {
      p_template_id: params.templateId,
      p_name: params.name,
      p_start_minute: params.startMinute,
      p_end_minute: params.endMinute,
      p_break_duration_minutes: params.breakDurationMinutes,
      p_default_break_start_minute: params.defaultBreakStartMinute,
      p_active: params.active,
    });
    if (error) throw new Error(`Could not update shift template: ${error.message}`);
    syncEngine.schedule(0);
  },

  async deleteShiftTemplate(templateId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('delete_shift_template', {
      p_template_id: templateId,
    });
    if (error) throw new Error(`Could not delete shift template: ${error.message}`);
    syncEngine.schedule(0);
  },

  async assignShift(params: {
    therapistId: UUID;
    shiftTemplateId: UUID;
    weekdays: number[];
    breakStartMinute?: number | null;
  }): Promise<UUID> {
    const supabase = supabaseOrThrow();
    const { data, error } = await supabase.rpc('assign_shift', {
      p_therapist_id: params.therapistId,
      p_shift_template_id: params.shiftTemplateId,
      p_weekdays: params.weekdays,
      p_break_start_minute: params.breakStartMinute ?? null,
    });
    if (error) throw new Error(`Could not assign shift: ${error.message}`);
    syncEngine.schedule(0);
    return data as UUID;
  },

  /** Returns the new assignment id, or null for "Clinic hours" (hours = null),
   *  which creates no assignment row — it supersedes all and sets working_hours = null. */
  async assignCustomHours(therapistId: UUID, hours: WorkingHours | null): Promise<UUID | null> {
    const supabase = supabaseOrThrow();
    const { data, error } = await supabase.rpc('assign_custom_hours', {
      p_therapist_id: therapistId,
      p_custom_hours: hours,
    });
    if (error) throw new Error(`Could not assign custom hours: ${error.message}`);
    syncEngine.schedule(0);
    return (data as UUID | null) ?? null;
  },

  async requestShiftAssignment(params: {
    therapistId: UUID;
    shiftTemplateId: UUID;
    weekdays: number[];
    breakStartMinute?: number | null;
    note?: string | null;
  }): Promise<UUID> {
    const supabase = supabaseOrThrow();
    const { data, error } = await supabase.rpc('request_shift_assignment', {
      p_therapist_id: params.therapistId,
      p_shift_template_id: params.shiftTemplateId,
      p_weekdays: params.weekdays,
      p_break_start_minute: params.breakStartMinute ?? null,
      p_note: params.note ?? null,
    });
    if (error) throw new Error(`Could not submit shift request: ${error.message}`);
    syncEngine.schedule(0);
    return data as UUID;
  },

  async requestCustomHours(therapistId: UUID, hours: WorkingHours | null, note?: string | null): Promise<UUID> {
    const supabase = supabaseOrThrow();
    const { data, error } = await supabase.rpc('request_custom_hours', {
      p_therapist_id: therapistId,
      p_custom_hours: hours,
      p_note: note ?? null,
    });
    if (error) throw new Error(`Could not submit hours request: ${error.message}`);
    syncEngine.schedule(0);
    return data as UUID;
  },

  async approveShiftAssignment(requestId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('approve_shift_assignment', { p_request_id: requestId });
    if (error) throw new Error(`Could not approve request: ${error.message}`);
    syncEngine.schedule(0);
  },

  async declineShiftAssignment(requestId: UUID, note?: string | null): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('decline_shift_assignment', { p_request_id: requestId, p_note: note ?? null });
    if (error) throw new Error(`Could not decline request: ${error.message}`);
    syncEngine.schedule(0);
  },

  async setBreakPlacement(assignmentId: UUID, breakStartMinute: number): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('set_break_placement', {
      p_assignment_id: assignmentId,
      p_break_start_minute: breakStartMinute,
    });
    if (error) throw new Error(`Could not move break: ${error.message}`);
    syncEngine.schedule(0);
  },

  /** Marks every day in [from, to] closed (holiday / one-off closure). */
  async setClosedDates(clinicId: UUID, from: string, to: string, label: string | null): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('set_clinic_closed_dates', {
      p_clinic_id: clinicId,
      p_from: from,
      p_to: to,
      p_label: label,
    });
    if (error) throw new Error(`Could not save closed days: ${error.message}`);
    syncEngine.schedule(0);
  },

  async removeClosedDates(clinicId: UUID, from: string, to: string): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('remove_clinic_closed_dates', {
      p_clinic_id: clinicId,
      p_from: from,
      p_to: to,
    });
    if (error) throw new Error(`Could not reopen those days: ${error.message}`);
    syncEngine.schedule(0);
  },

  async markAppointmentArrived(appointmentId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('mark_appointment_arrived', {
      p_appointment_id: appointmentId,
    });
    if (error) throw new Error(`Could not update: ${error.message}`);
    syncEngine.schedule(0);
  },

  /** Called right after New Visit saves, when the visit was started from
   *  an appointment row — see `NewVisitPage`'s `appointmentId` search param.
   *  Queues the link; the sync engine sends it once the visit is on the
   *  server (the RPC needs it there), so it works offline and survives a
   *  reload. Until then this device already shows the appointment as done. */
  async linkAppointmentVisit(appointmentId: UUID, visitId: UUID, patientId: UUID): Promise<void> {
    await enqueueAppointmentLink({ appointmentId, visitId, patientId });
    syncEngine.schedule(0);
  },

  /** Opens WhatsApp with the patient message (booked / moved / cancelled /
   *  reminder). One tap per recipient — wa.me can't send in bulk. */
  messagePatient(
    kind: PatientMessageKind,
    input: { patientName: string; patientPhone: string | null; clinicName: string; scheduledAt: string; therapistName?: string | null; sessions?: number }
  ): void {
    openPatientWhatsAppChat(patientMessage(kind, input), input.patientPhone);
  },

  /** Opens WhatsApp to the therapist; patient shown as first name + initial. */
  messageTherapist(
    kind: TherapistMessageKind,
    input: { therapistName: string; therapistPhone: string | null; patientName: string; scheduledAt: string; sessions?: number }
  ): void {
    openPatientWhatsAppChat(therapistMessage(kind, input), input.therapistPhone);
  },

  /** Opens WhatsApp with arbitrary prepared text (e.g. a therapist's day list). */
  sendText(text: string, phone: string | null): void {
    openPatientWhatsAppChat(text, phone);
  },

  /** Kept for existing callers: the "booked" patient message. */
  async shareBookingConfirmation(
    _clinicId: UUID,
    patientName: string,
    patientPhone: string | null,
    clinicName: string,
    scheduledAt: string
  ): Promise<void> {
    openPatientWhatsAppChat(patientMessage('booked', { patientName, clinicName, scheduledAt }), patientPhone);
  },
};
