import type { UUID } from '@/domain/types';
import {
  whatsappBusinessService,
  type WhatsAppMessageKind,
} from '@/services/whatsappBusinessService';
import { normalizePhoneForWaMe, openWhatsAppChat } from './pdfShare';

/**
 * Placeholder Meta-approved template names — Meta rejects unknown names and
 * the edge function returns success: false, which falls back to wa.me.
 */
const WHATSAPP_TEMPLATES: Record<WhatsAppMessageKind, string> = {
  feedback_request: 'feedback_request_v1',
  booking_confirmation: 'booking_confirmation_v1',
  therapist_notify: 'therapist_notify_v1',
  google_review: 'google_review_nudge_v1',
  reminder_stale_package: 'reminder_stale_package_v1',
  reminder_single_visit: 'reminder_single_visit_v1',
  payment_reminder: 'payment_reminder_v1',
};

async function shouldSendViaBusinessApi(clinicId: UUID): Promise<boolean> {
  const status = await whatsappBusinessService.getConfigStatus(clinicId);
  return Boolean(status?.enabled && status.hasToken && status.phoneNumberId);
}

/**
 * Single entry point for staff-initiated WhatsApp (feedback, booking, reminders
 * that go through this helper). Default: open wa.me like pending-bill reminders.
 * When Settings → WhatsApp Business API is **enabled** with credentials, tries
 * the server send first; on failure or when off, falls back to wa.me.
 */
export async function sendWhatsAppMessage(params: {
  clinicId: UUID;
  kind: WhatsAppMessageKind;
  toPhone: string | null;
  bodyParams: string[];
  shareText: string;
  shareTitle: string;
  popup?: Window | null;
}): Promise<void> {
  if (!params.toPhone?.trim()) {
    if (params.popup) params.popup.close();
    alert('Patient has no phone number on file');
    return;
  }

  if (await shouldSendViaBusinessApi(params.clinicId)) {
    const { sent } = await whatsappBusinessService.sendViaBusinessApi({
      clinicId: params.clinicId,
      kind: params.kind,
      toPhone: normalizePhoneForWaMe(params.toPhone),
      templateName: WHATSAPP_TEMPLATES[params.kind],
      languageCode: 'en',
      bodyParams: params.bodyParams,
    });
    if (sent) {
      if (params.popup) params.popup.close();
      alert('Message sent to the patient on WhatsApp.');
      return;
    }
  }

  openWhatsAppChat(params.shareText, params.toPhone, params.popup);
}
