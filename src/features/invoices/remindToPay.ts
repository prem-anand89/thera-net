import { formatAmount } from '@/domain/money';
import { buildUpiPayUri, clinicCanShowUpiQr, clinicUpiPayeeName } from '@/domain/upiPay';
import { openPatientWhatsAppChat } from '@/lib/pdfShare';
import type { Clinic, Invoice } from '@/domain/types';

/**
 * Opens WhatsApp with a reminder for a bill that still has money due (with a UPI pay link when the clinic shows a UPI QR).
 * Returns false, sending nothing, when the patient has no phone number.
 */
export function remindToPay({
  clinic,
  invoice,
  remainingPaise,
  phone,
}: {
  clinic: Clinic;
  invoice: Invoice;
  remainingPaise: number;
  phone: string | null | undefined;
}): boolean {
  if (!phone) return false;
  const upiPayUri = clinicCanShowUpiQr(clinic)
    ? buildUpiPayUri({
        vpa: clinic.upiVpa ?? '',
        payeeName: clinicUpiPayeeName(clinic),
        amountPaise: remainingPaise,
        note: invoice.invoiceNo,
      })
    : null;

  let text = `Hi ${invoice.patientSnapshot.name},\n\nThis is a reminder from ${clinic.name} regarding your pending bill (${invoice.invoiceNo}) of ${formatAmount(remainingPaise)}.`;
  if (upiPayUri) {
    text += `\n\nYou can pay directly via UPI using this link:\n${upiPayUri}`;
  }
  openPatientWhatsAppChat(text, phone);
  return true;
}
