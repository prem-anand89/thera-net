import type { UUID } from '@/domain/types';
import type { WhatsAppMessageKind } from '@/services/whatsappBusinessService';
import { openPatientWhatsAppChat } from './pdfShare';

/**
 * Staff-initiated patient WhatsApp (google review nudge, package reminders).
 * Same wa.me path as visit-row payment reminders.
 */
export function sendWhatsAppMessage(params: {
  clinicId: UUID;
  kind: WhatsAppMessageKind;
  toPhone: string | null;
  bodyParams: string[];
  shareText: string;
  shareTitle: string;
}): void {
  openPatientWhatsAppChat(params.shareText, params.toPhone);
}
