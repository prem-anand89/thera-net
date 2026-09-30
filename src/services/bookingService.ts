import type { UUID, WorkingHours } from '@/domain/types';
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
  async getBookingClinicInfo(slug: string): Promise<{ name: string; logoPath: string | null; slotDurationMinutes: number; bookingStartHour: number; bookingEndHour: number }> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.rpc('get_booking_clinic_info', { p_slug: slug });
    if (error) throw new Error(error.message);
    return data as { name: string; logoPath: string | null; slotDurationMinutes: number; bookingStartHour: number; bookingEndHour: number };
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
    preferredTimeText: string | null
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
    });
    if (error) throw new Error(error.message);
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

  async declineAppointmentRequest(requestId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('decline_appointment_request', {
      p_request_id: requestId,
    });
    if (error) throw new Error(`Could not decline: ${error.message}`);
    syncEngine.schedule(0);
  },

  async rescheduleAppointment(
    appointmentId: UUID,
    newScheduledAt: string,
    durationMinutes?: number
  ): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('reschedule_appointment', {
      p_appointment_id: appointmentId,
      p_new_scheduled_at: newScheduledAt,
      p_duration_minutes: durationMinutes ?? null,
    });
    if (error) throw new Error(`Could not reschedule: ${error.message}`);
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
   *  an appointment row — see `NewVisitPage`'s `appointmentId` search param. */
  async linkAppointmentVisit(appointmentId: UUID, visitId: UUID, patientId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('link_appointment_visit', {
      p_appointment_id: appointmentId,
      p_visit_id: visitId,
      p_patient_id: patientId,
    });
    if (error) throw new Error(`Could not link visit: ${error.message}`);
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
