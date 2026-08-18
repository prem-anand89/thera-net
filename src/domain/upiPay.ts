import type { Paise } from './money';
import { paiseToRupees } from './money';
import { formatDateDMY } from './fiscalYear';
import type { Clinic } from './types';

/** NPCI transaction-note length; GPay/PhonePe truncate past this. */
export const UPI_NOTE_MAX = 50;

const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9.-]{2,64}$/;

export function isValidUpiVpa(vpa: string): boolean {
  return VPA_RE.test(vpa.trim());
}

export function formatUpiAmountRupees(amountPaise: Paise): string {
  return paiseToRupees(amountPaise).toFixed(2);
}

/** Patient ID + visit date (+ name if it still fits) for the UPI `tn` field. */
export function buildUpiNote(input: { mrno: string; visitDate: string; patientName?: string | null }): string {
  const mrno = input.mrno.trim();
  const date = input.visitDate ? formatDateDMY(input.visitDate) : '';
  let note = [mrno, date].filter(Boolean).join(' ');
  const name = input.patientName?.trim();
  if (name) {
    const withName = note ? `${note} ${name}` : name;
    if (withName.length <= UPI_NOTE_MAX) note = withName;
  }
  return note.slice(0, UPI_NOTE_MAX);
}

export function buildUpiPayUri(input: {
  vpa: string;
  payeeName: string;
  amountPaise: Paise;
  note: string;
}): string {
  const parts = [
    `pa=${encodeURIComponent(input.vpa.trim())}`,
    `pn=${encodeURIComponent(input.payeeName.trim() || 'Clinic')}`,
    `am=${formatUpiAmountRupees(input.amountPaise)}`,
    'cu=INR',
  ];
  const note = input.note.trim();
  if (note) parts.push(`tn=${encodeURIComponent(note)}`);
  return `upi://pay?${parts.join('&')}`;
}

export function clinicCanShowUpiQr(
  clinic: Pick<Clinic, 'upiQrEnabled' | 'upiVpa' | 'upiQrPath'>
): boolean {
  if (!clinic.upiQrEnabled) return false;
  const vpa = clinic.upiVpa?.trim() ?? '';
  const hasVpa = vpa.length > 0 && isValidUpiVpa(vpa);
  const hasImage = Boolean(clinic.upiQrPath?.trim());
  return hasVpa || hasImage;
}

export function clinicUpiPayeeName(clinic: Pick<Clinic, 'name' | 'upiPayeeName'>): string {
  return clinic.upiPayeeName?.trim() || clinic.name;
}
