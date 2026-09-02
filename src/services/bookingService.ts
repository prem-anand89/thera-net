import type { UUID } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';
import { sendWhatsAppMessage } from '@/lib/whatsappSend';

/**
 * Patient Communications, Slice 5: public booking requests → confirmed
 * appointments. Every function here is a thin RPC wrapper — nothing in
 * this module writes Dexie/outbox, matching the "every write is
 * online-only" rule the handoff doc states for the whole booking
 * workflow (see `src/lib/db.ts`'s comment on why `appointment_requests`/
 * `appointments` are read-only-synced tables). Public (anonymous) calls
 * and staff calls share this one file rather than being split, mirroring
 * `feedbackService.ts`'s single-file-per-workflow shape.
 */

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
  async getBookingClinicName(slug: string): Promise<string> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.rpc('get_booking_clinic_name', { p_slug: slug });
    if (error) throw new Error(error.message);
    return data as string;
  },

  async listBookingTherapists(slug: string): Promise<{ id: UUID; name: string }[]> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.rpc('list_booking_therapists', { p_slug: slug });
    if (error) throw new Error(error.message);
    return (data as { id: UUID; name: string }[] | null) ?? [];
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

  /** Returns the new `appointments.id`. */
  async confirmAppointmentRequest(
    requestId: UUID,
    scheduledAt: string,
    therapistId: UUID | null
  ): Promise<UUID> {
    const supabase = supabaseOrThrow();
    const { data, error } = await supabase.rpc('confirm_appointment_request', {
      p_request_id: requestId,
      p_scheduled_at: scheduledAt,
      p_therapist_id: therapistId,
    });
    if (error) throw new Error(`Could not confirm: ${error.message}`);
    return data as UUID;
  },

  /** Manual/staff-entered booking, alongside the public patient-facing
   *  link — goes straight to a confirmed appointment (no pending request
   *  row) since staff already know the date/time/therapist when entering
   *  one by hand. Returns the new `appointments.id`, same as
   *  `confirmAppointmentRequest`, so callers can reuse the same
   *  post-confirm banner either way. */
  async createAppointmentStaff(
    clinicId: UUID,
    name: string,
    phone: string,
    therapistId: UUID | null,
    scheduledAt: string
  ): Promise<UUID> {
    const supabase = supabaseOrThrow();
    const { data, error } = await supabase.rpc('create_appointment_staff', {
      p_clinic_id: clinicId,
      p_name: name,
      p_phone: phone,
      p_therapist_id: therapistId,
      p_scheduled_at: scheduledAt,
    });
    if (error) throw new Error(`Could not create booking: ${error.message}`);
    return data as UUID;
  },

  async declineAppointmentRequest(requestId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('decline_appointment_request', {
      p_request_id: requestId,
    });
    if (error) throw new Error(`Could not decline: ${error.message}`);
  },

  async rescheduleAppointment(appointmentId: UUID, newScheduledAt: string): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('reschedule_appointment', {
      p_appointment_id: appointmentId,
      p_new_scheduled_at: newScheduledAt,
    });
    if (error) throw new Error(`Could not reschedule: ${error.message}`);
  },

  async markAppointmentNoShow(appointmentId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('mark_appointment_no_show', {
      p_appointment_id: appointmentId,
    });
    if (error) throw new Error(`Could not update: ${error.message}`);
  },

  async cancelAppointment(appointmentId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('cancel_appointment', {
      p_appointment_id: appointmentId,
    });
    if (error) throw new Error(`Could not cancel: ${error.message}`);
  },

  async markAppointmentArrived(appointmentId: UUID): Promise<void> {
    const supabase = supabaseOrThrow();
    const { error } = await supabase.rpc('mark_appointment_arrived', {
      p_appointment_id: appointmentId,
    });
    if (error) throw new Error(`Could not update: ${error.message}`);
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
  },

  /** Explicit, separate share action from `shareTherapistNotify` — see
   *  the plan's own "two independent share actions, not one combined
   *  message" note; a click sends one WhatsApp share sheet, not two. */
  async shareBookingConfirmation(
    clinicId: UUID,
    patientName: string,
    patientPhone: string | null,
    clinicName: string,
    scheduledAt: string
  ): Promise<void> {
    const when = new Date(scheduledAt).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const text = `Hi ${patientName}, your appointment at ${clinicName} is confirmed for ${when}. See you then!`;
    await sendWhatsAppMessage({
      clinicId,
      kind: 'booking_confirmation',
      toPhone: patientPhone,
      bodyParams: [patientName, clinicName, when],
      shareText: text,
      shareTitle: 'Send confirmation',
    });
  },

  /** Uses the Business API when the therapist has a phone on file and the
   *  clinic has one configured; falls back to the share sheet otherwise —
   *  same as every other send action in this file, now that `Therapist`
   *  carries a `phone` field. */
  async shareTherapistNotify(
    clinicId: UUID,
    therapistName: string,
    therapistPhone: string | null,
    patientName: string,
    scheduledAt: string
  ): Promise<void> {
    const when = new Date(scheduledAt).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const text = `Hi ${therapistName}, you have an appointment with ${patientName} confirmed for ${when}.`;
    await sendWhatsAppMessage({
      clinicId,
      kind: 'therapist_notify',
      toPhone: therapistPhone,
      bodyParams: [therapistName, patientName, when],
      shareText: text,
      shareTitle: 'Notify therapist',
    });
  },
};
