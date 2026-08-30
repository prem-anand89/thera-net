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
  };
}
