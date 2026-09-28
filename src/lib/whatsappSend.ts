import type { UUID } from '@/domain/types';
import type { WhatsAppMessageKind } from '@/services/whatsappBusinessService';
import { openWhatsAppChat } from './pdfShare';

/**
 * Staff-facing WhatsApp sends (feedback, booking confirmation, reminders).
 * Opens a `wa.me` chat pre-addressed to the patient — same path as the
 * visit-row "Send WhatsApp reminder" for pending bills. WhatsApp Business
 * API is configured separately in Settings for clinics that want automated
 * sends later; it is not invoked here so therapists always get the familiar
 * click-to-send flow.
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
  openWhatsAppChat(params.shareText, params.toPhone, params.popup);
}
