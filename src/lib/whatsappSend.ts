import type { UUID } from '@/domain/types';
import {
  whatsappBusinessService,
  type WhatsAppMessageKind,
} from '@/services/whatsappBusinessService';
import { shareTextViaWhatsApp } from './pdfShare';

/**
 * Placeholder Meta-approved template names, one per `WhatsAppMessageKind`.
 * A real template name is assigned by Meta when a clinic submits it for
 * approval, is entirely clinic/business-specific, and has no relationship
 * to this string -- these exist only so the six send actions have
 * something syntactically valid to send while nobody has an approved
 * template yet. Meta rejects an unrecognized name with
 * `{ configured: true, success: false }`, which `sendWhatsAppMessage`
 * below treats the same as "not configured" and falls back to the share
 * sheet -- so leaving these as placeholders is safe, not just provisional.
 *
 * `bodyParams` ordering below must match each template's own `{{1}}`,
 * `{{2}}`, ... variables once a real one exists; there's no way to know
 * that shape in advance, so it's a best-effort guess at "the same
 * information the existing share-sheet text already sends", in the same
 * order.
 */
const WHATSAPP_TEMPLATES: Record<WhatsAppMessageKind, string> = {
  feedback_request: 'feedback_request_v1',
  booking_confirmation: 'booking_confirmation_v1',
  therapist_notify: 'therapist_notify_v1',
  google_review: 'google_review_nudge_v1',
  reminder_stale_package: 'reminder_stale_package_v1',
  reminder_single_visit: 'reminder_single_visit_v1',
};

/**
 * Best-effort E.164-ish normalization for Meta's `to` field: strips
 * everything but digits, and assumes a bare 10-digit number is an Indian
 * mobile number missing its country code -- this app's phone fields are
 * free text with no format enforced, and a 10-digit local number (no `91`
 * prefix) is what staff overwhelmingly type. Any other digit count is
 * passed through as-is; Meta's own validation is the real backstop, and a
 * malformed number here just means the send fails and falls back to the
 * share sheet, same as an unconfigured clinic.
 */
function normalizePhoneForWhatsApp(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

/**
 * The one place any of the app's WhatsApp send actions decide *how* to
 * send: try the clinic's configured Business API first (silent, no share
 * sheet, and the one path that writes a `message_log` row), and fall back
 * to the existing manual share sheet whenever the clinic hasn't configured
 * it, `toPhone` is unknown, Meta rejects the send, or the request fails
 * outright. Every existing caller of `shareTextViaWhatsApp` for one of the
 * six message kinds should call this instead, passing the same text it
 * already builds for the share sheet as `shareText`/`shareTitle`.
 */
export async function sendWhatsAppMessage(params: {
  clinicId: UUID;
  kind: WhatsAppMessageKind;
  toPhone: string | null;
  bodyParams: string[];
  shareText: string;
  shareTitle: string;
}): Promise<void> {
  if (params.toPhone) {
    const { sent } = await whatsappBusinessService.sendViaBusinessApi({
      clinicId: params.clinicId,
      kind: params.kind,
      toPhone: normalizePhoneForWhatsApp(params.toPhone),
      templateName: WHATSAPP_TEMPLATES[params.kind],
      languageCode: 'en',
      bodyParams: params.bodyParams,
    });
    if (sent) return;
  }
  await shareTextViaWhatsApp(params.shareText, params.shareTitle);
}
