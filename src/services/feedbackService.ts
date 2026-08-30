import type { FeedbackRequest, UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { getSupabase } from '@/lib/supabase';
import { shareTextViaWhatsApp } from '@/lib/pdfShare';

const FEEDBACK_LINK_EXPIRY_DAYS = 21;

function expiryFromNow(): string {
  const d = new Date();
  d.setDate(d.getDate() + FEEDBACK_LINK_EXPIRY_DAYS);
  return d.toISOString();
}

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
 * a visit. `askForFeedback` is a normal Dexie+outbox write — same as any
 * other clinic CRUD — with `token` left unset so the server's column
 * default (`generate_url_safe_token()`) fills it in on insert; the real
 * value round-trips back on the next pull (see `FeedbackRequest`'s own
 * doc comment for why). `resend` can't use that path — rotating a token
 * on an existing row is an UPDATE, where column defaults never fire — so
 * it goes through a small online-only RPC instead, the same reasoning
 * `invoiceService.issueForVisit` is an RPC rather than outbox-synced.
 */
export function createFeedbackService(repos: Repos) {
  return {
    async askForFeedback(
      clinicId: UUID,
      visitId: UUID,
      patientId: UUID,
      therapistId: UUID
    ): Promise<FeedbackRequest> {
      const request: FeedbackRequest = {
        id: crypto.randomUUID(),
        clinicId,
        visitId,
        patientId,
        therapistId,
        status: 'pending',
        expiresAt: expiryFromNow(),
        updatedAt: new Date().toISOString(),
      };
      await repos.feedbackRequests.put(request);
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
      clinicName: string
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
      await shareTextViaWhatsApp(
        feedbackShareMessage(patientName, clinicName, token),
        'Ask for feedback'
      );
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
      patientName: string,
      clinicName: string,
      googleReviewUrl: string
    ): Promise<void> {
      await shareTextViaWhatsApp(
        `Hi ${patientName}, so glad you had a great experience at ${clinicName}! Would you mind leaving us a quick Google review? ${googleReviewUrl}`,
        'Ask for a Google review'
      );
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
      patientName: string,
      clinicName: string,
      serviceName: string
    ): Promise<void> {
      await shareTextViaWhatsApp(
        `Hi ${patientName}, we noticed it's been a while since your last ${serviceName} session at ${clinicName}. We'd love to see you again — reach out whenever you're ready to continue!`,
        'Send reminder'
      );
    },

    /** Slice 4: re-engagement nudge for a patient with exactly one visit,
     *  no follow-up booked — reuses `dashboardService.singleVisitPatients`,
     *  same "no new detection" reasoning as the stale-package reminder. */
    async sendSingleVisitReminder(patientName: string, clinicName: string): Promise<void> {
      await shareTextViaWhatsApp(
        `Hi ${patientName}, thanks for visiting ${clinicName}! We hope you're doing well — let us know if you'd like to schedule a follow-up visit.`,
        'Send reminder'
      );
    },
  };
}
