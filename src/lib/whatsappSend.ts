import type { UUID } from '@/domain/types';
import type { WhatsAppMessageKind } from '@/services/whatsappBusinessService';
import { openPatientWhatsAppChat } from './pdfShare';

/**
 * Staff-initiated patient WhatsApp (feedback, booking, reminders). Always
 * opens wa.me like visit-row payment reminders — identical UX for every
 * clinic. WhatsApp Business API credentials in Settings are stored for a
 * future automated-send path and are **not** invoked here.
 */
export function sendWhatsAppMessage(params: {
  clinicId: UUID;
  kind: WhatsAppMessageKind;
  toPhone: string | null;
  bodyParams: string[];
  shareText: string;
  shareTitle: string;
  popup?: Window | null;
}): void {
  openPatientWhatsAppChat(params.shareText, params.toPhone, params.popup);
}
