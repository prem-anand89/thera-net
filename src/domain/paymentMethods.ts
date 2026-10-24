import type { Clinic, PaymentMethod } from './types';

/** Every payment method, in the order screens list them. `partner` is only offered to a clinic with a partner. */
export const ALL_PAYMENT_METHODS: PaymentMethod[] = ['upi', 'cash', 'card', 'bank_transfer', 'cheque', 'partner'];

const PLAIN_LABELS: Record<Exclude<PaymentMethod, 'partner'>, string> = {
  upi: 'UPI',
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
};

type PartnerNames = Partial<Pick<Clinic, 'hasPartner' | 'partnerHospitalName' | 'partnerShareLabel'>>;

/** The partner's name as staff know it: hospital name, else the share label, else a plain word. */
export function partnerName(clinic: PartnerNames): string {
  return clinic.partnerHospitalName?.trim() || clinic.partnerShareLabel?.trim() || 'partner';
}

/** "Collected by Health Valley" / "Collected by partner" for `partner`; the plain name for everything else. */
export function paymentMethodLabel(method: PaymentMethod, clinic: PartnerNames): string {
  return method === 'partner' ? `Collected by ${partnerName(clinic)}` : PLAIN_LABELS[method] ?? method;
}

/** Options for a method picker: `partner` appears only for a clinic with a partner. */
export function paymentMethodOptions(clinic: PartnerNames): { value: PaymentMethod; label: string }[] {
  return ALL_PAYMENT_METHODS.filter((m) => m !== 'partner' || clinic.hasPartner).map((m) => ({
    value: m,
    label: paymentMethodLabel(m, clinic),
  }));
}

/**
 * Money that reached the clinic. A payment collected by the partner settles the
 * patient's bill but never sat in the clinic's drawer, so every cash-in-hand
 * total (Collected tile, Daybook, by-method breakdowns) goes through here.
 */
export function isCashInHand(method: PaymentMethod): boolean {
  return method !== 'partner';
}

/**
 * The method a payment screen opens with: the clinic's default (or the partner
 * when it collects), then what this device used last — only when the clinic set
 * no default, so a one-off cash walk-in never changes what the next visit
 * preselects — then UPI. A stored value the clinic can no longer use is skipped.
 */
export function defaultPaymentMethod(
  clinic: Pick<Clinic, 'hasPartner' | 'partnerCollects' | 'defaultPaymentMethod'>,
  lastUsed?: PaymentMethod | null
): PaymentMethod {
  const usable = (m: PaymentMethod | null | undefined): m is PaymentMethod =>
    Boolean(m) && (m !== 'partner' || Boolean(clinic.hasPartner));
  if (clinic.hasPartner && clinic.partnerCollects) return 'partner';
  if (usable(clinic.defaultPaymentMethod)) return clinic.defaultPaymentMethod;
  if (usable(lastUsed)) return lastUsed;
  return 'upi';
}

const LAST_USED_KEY = 'theranet:last-payment-method';

/** Per-device memory of the last method used; every access is guarded (private windows, blocked storage). */
export function readLastPaymentMethod(clinicId: string): PaymentMethod | null {
  try {
    const raw = window.localStorage.getItem(`${LAST_USED_KEY}:${clinicId}`);
    return raw && (ALL_PAYMENT_METHODS as string[]).includes(raw) ? (raw as PaymentMethod) : null;
  } catch {
    return null;
  }
}

export function rememberPaymentMethod(clinicId: string, method: PaymentMethod): void {
  try {
    window.localStorage.setItem(`${LAST_USED_KEY}:${clinicId}`, method);
  } catch {
    /* storage unavailable: the memory is a convenience only */
  }
}

/** Per visit, how much of its payments the partner collected. */
export function partnerPaymentsByVisit(
  payments: Iterable<{ visitId: string; method: PaymentMethod; amountPaise: number }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of payments) {
    if (p.method === 'partner') map.set(p.visitId, (map.get(p.visitId) ?? 0) + p.amountPaise);
  }
  return map;
}

/**
 * A visit whose whole bill the partner collected: the partner billed the patient, so the clinic
 * shows a "Collected by {partner}" pill (not the green Paid) and offers no invoice or receipt for it.
 */
export function isFullyPartnerCollected(billPaise: number, partnerCollectedPaise: number | undefined): boolean {
  return billPaise > 0 && (partnerCollectedPaise ?? 0) >= billPaise;
}
