import type { FeedbackRequest, FeedbackRequestStatus, UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { getSupabase } from '@/lib/supabase';
import { sendWhatsAppMessage } from '@/lib/whatsappSend';

/** Public `/f/$token` URL for a feedback request's token. */
export function feedbackLinkUrl(token: string): string {
  return `${window.location.origin}/f/${token}`;
}

/**
 * Shared message template for the "ask for feedback" share — hardcoded for
 * now; per-clinic template editing is a later-slice Settings concern, not
 * Slice 1's job (see HANDOFF-patient-comms.md's implementation-slices
 * table).
 */
export function feedbackShareMessage(
  patientName: string,
  clinicName: string,
  token: string
): string {
  return `Hi ${patientName}, thanks for visiting ${clinicName}! We'd love your feedback: ${feedbackLinkUrl(token)}`;
}

/**
 * Patient Communications, Slice 1: staff asking a patient for feedback on
 * a visit. Originally a normal Dexie+outbox write (token left unset for
 * the server's column default to fill in on insert, round-tripping back on
 * the next pull) — but that meant the token, and so the share sheet,
 * wasn't available until the next sync pull, and the very first ask never
 * shared anything at all (see `resend`'s own comment on why an UPDATE
 * needs an RPC; an INSERT run through the outbox has the same "no token
 * back yet" gap, just on the create side instead of the rotate side). Now
 * goes through `create_feedback_request()`, an online-only RPC returning
 * the full row in one round trip, matching `resend`'s shape: write the
 * result straight into Dexie and open the WhatsApp share sheet immediately.
 */
export function createFeedbackService(repos: Repos) {
  return {
    async askForFeedback(
      visitId: UUID,
      patientName: string,
      patientPhone: string | null,
      clinicName: string,
      preOpenedTab?: Window | null
    ): Promise<FeedbackRequest> {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase is not configured');
      if (!navigator.onLine) {
        throw new Error('Asking for feedback needs a connection — reconnect and try again.');
      }
      const { data, error } = await supabase.rpc('create_feedback_request', {
        p_visit_id: visitId,
      });
      if (error) throw new Error(`Could not ask for feedback: ${error.message}`);

      const row = (
        data as
          | {
              id: UUID;
              clinic_id: UUID;
              visit_id: UUID;
              patient_id: UUID;
              therapist_id: UUID;
              token: string;
              status: FeedbackRequestStatus;
              expires_at: string;
              updated_at: string;
              created_by: UUID | null;
              updated_by: UUID | null;
            }[]
          | null
      )?.[0];
      if (!row) throw new Error('Could not ask for feedback: no response from the server.');

      const request: FeedbackRequest = {
        id: row.id,
        clinicId: row.clinic_id,
        visitId: row.visit_id,
        patientId: row.patient_id,
        therapistId: row.therapist_id,
        token: row.token,
        status: row.status,
        expiresAt: row.expires_at,
        updatedAt: row.updated_at,
        createdBy: row.created_by ?? undefined,
        updatedBy: row.updated_by ?? undefined,
      };
      await repos.feedbackRequests.putLocal(request);
      await sendWhatsAppMessage({
        clinicId: row.clinic_id,
        kind: 'feedback_request',
        toPhone: patientPhone,
        bodyParams: [patientName, clinicName, feedbackLinkUrl(row.token)],
        shareText: feedbackShareMessage(patientName, clinicName, row.token),
        shareTitle: 'Ask for feedback',
        preOpenedTab,
      });
      return request;
    },

    /**
     * Rotates the token (fresh 21-day expiry) and immediately opens the
     * WhatsApp share sheet with the new link — one click covers both
     * "resend" and "share" for a request whose token is already known
     * (see `VisitFeedbackLink`'s single-button design for this state).
     */
    async resend(
      request: FeedbackRequest,
      patientName: string,
      patientPhone: string | null,
      clinicName: string,
      preOpenedTab?: Window | null
    ): Promise<FeedbackRequest> {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase is not configured');
      if (!navigator.onLine) {
        throw new Error('Resending needs a connection — reconnect and try again.');
      }
      const { data, error } = await supabase.rpc('rotate_feedback_request_token', {
        p_request_id: request.id,
      });
      if (error) throw new Error(`Could not resend: ${error.message}`);

      const token = data as string;
      const updated: FeedbackRequest = {
        ...request,
        token,
        status: 'pending',
        updatedAt: new Date().toISOString(),
      };
      await repos.feedbackRequests.putLocal(updated);
      await sendWhatsAppMessage({
        clinicId: request.clinicId,
        kind: 'feedback_request',
        toPhone: patientPhone,
        bodyParams: [patientName, clinicName, feedbackLinkUrl(token)],
        shareText: feedbackShareMessage(patientName, clinicName, token),
        shareTitle: 'Ask for feedback',
        preOpenedTab,
      });
      return updated;
    },

    /**
     * Slice 3: staff nudging a 4-5* respondent toward a Google review — a
     * pure share action, no DB write. Callers gate this on rating >= 4 and
     * a configured `clinic.googleReviewUrl` themselves (see
     * `VisitFeedbackLink`); this function trusts that gating rather than
     * re-checking it, since it has no rating of its own to check against.
     */
    async askForGoogleReview(
      clinicId: UUID,
      patientName: string,
      patientPhone: string | null,
      clinicName: string,
      googleReviewUrl: string,
      preOpenedTab?: Window | null
    ): Promise<void> {
      const text = `Hi ${patientName}, so glad you had a great experience at ${clinicName}! Would you mind leaving us a quick Google review? ${googleReviewUrl}`;
      await sendWhatsAppMessage({
        clinicId,
        kind: 'google_review',
        toPhone: patientPhone,
        bodyParams: [patientName, clinicName, googleReviewUrl],
        shareText: text,
        shareTitle: 'Ask for a Google review',
        preOpenedTab,
      });
    },

    /**
     * Slice 4: re-engagement nudge for a package that's gone quiet mid-way
     * through. No new detection — reuses the existing `stale` flag on
     * `OpenPackageRow` (Workspace/Ledger's own "Due for follow-up" lists)
     * per the doc's own instruction. Pure share action, same as the Google
     * review nudge — no DB write, no booking link (public booking is a
     * later slice, so there's nothing to link to yet).
     */
    async sendStalePackageReminder(
      clinicId: UUID,
      patientName: string,
      patientPhone: string | null,
      clinicName: string,
      serviceName: string,
      preOpenedTab?: Window | null
    ): Promise<void> {
      const text = `Hi ${patientName}, we noticed it's been a while since your last ${serviceName} session at ${clinicName}. We'd love to see you again — reach out whenever you're ready to continue!`;
      await sendWhatsAppMessage({
        clinicId,
        kind: 'reminder_stale_package',
        toPhone: patientPhone,
        bodyParams: [patientName, serviceName, clinicName],
        shareText: text,
        shareTitle: 'Send reminder',
        preOpenedTab,
      });
    },

    /** Slice 4: re-engagement nudge for a patient with exactly one visit,
     *  no follow-up booked — reuses `dashboardService.singleVisitPatients`,
     *  same "no new detection" reasoning as the stale-package reminder. */
    async sendSingleVisitReminder(
      clinicId: UUID,
      patientName: string,
      patientPhone: string | null,
      clinicName: string,
      preOpenedTab?: Window | null
    ): Promise<void> {
      const text = `Hi ${patientName}, thanks for visiting ${clinicName}! We hope you're doing well — let us know if you'd like to schedule a follow-up visit.`;
      await sendWhatsAppMessage({
        clinicId,
        kind: 'reminder_single_visit',
        toPhone: patientPhone,
        bodyParams: [patientName, clinicName],
        shareText: text,
        shareTitle: 'Send reminder',
        preOpenedTab,
      });
    },

    /**
     * Front-desk parity for the Google review nudge: `feedback_responses`
     * (and its `rating` column) never reaches a non-admin's Dexie at all —
     * RLS's `feedback_responses_select` is `is_clinic_admin()`-only, so the
     * row is filtered out at sync-pull time, not hidden client-side. A
     * front_desk caller has no rating to check `>= 4` against locally, so
     * this calls a role-blind RPC instead: it returns only the set of
     * `feedback_requests.id`s that currently qualify, never a rating value
     * or a comment (see the `list_google_review_eligible_requests`
     * migration's own comment). Online-only, same reasoning as `resend` —
     * this is a live eligibility check, not sync-engine data.
     */
    async listGoogleReviewEligibleRequestIds(clinicId: UUID): Promise<Set<UUID>> {
      const supabase = getSupabase();
      if (!supabase || !navigator.onLine) return new Set();
      const { data, error } = await supabase.rpc('list_google_review_eligible_requests', {
        p_clinic_id: clinicId,
      });
      if (error) return new Set();
      return new Set((data as UUID[] | null) ?? []);
    },
  };
}
