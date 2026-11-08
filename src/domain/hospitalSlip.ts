import type { Invoice, Therapist } from './types';
import { admissionRows } from './invoiceClinical';
import { formatDateDMY } from './fiscalYear';

export interface HospitalSlipRow {
  /** One date, or first – last when the line spans several sessions. */
  dates: string;
  service: string;
  sessions: number;
  therapist: string;
  chargePaise: number;
}

export interface HospitalSlip {
  invoiceNo: string;
  patientName: string;
  mrno: string;
  stayRows: { label: string; value: string }[];
  rows: HospitalSlipRow[];
  totalPaise: number;
  /** Everyone whose session is on the slip, once each, for the signature lines. */
  therapists: string[];
}

function datesOf(sessionDates: string[]): string {
  if (sessionDates.length === 0) return '';
  const sorted = [...sessionDates].sort();
  const first = formatDateDMY(sorted[0]);
  const last = formatDateDMY(sorted[sorted.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * The hospital billing slip for an inpatient bill: the compact voucher the hospital counter reconciles against, built
 * only from the issued invoice (its lines and its frozen stay block), so it always matches the bill and never drifts
 * from live records. One row per bill line: dates, service, sessions, therapist, charge.
 */
export function buildHospitalSlip(invoice: Invoice, therapists: Pick<Therapist, 'id' | 'name'>[]): HospitalSlip {
  const nameOf = new Map(therapists.map((t) => [t.id, t.name]));
  const fallback = invoice.therapistId ? nameOf.get(invoice.therapistId) : undefined;
  const rows: HospitalSlipRow[] = invoice.lineItems.map((li) => {
    const names = (li.therapistIds ?? []).map((id) => nameOf.get(id)).filter((n): n is string => Boolean(n));
    return {
      dates: datesOf(li.sessionDates),
      service: li.serviceName,
      sessions: li.billedSessionCount ?? li.sessionDates.length,
      therapist: names.length > 0 ? [...new Set(names)].join(', ') : (fallback ?? ''),
      chargePaise: li.totalPaise,
    };
  });
  const therapistNames = [...new Set(rows.flatMap((r) => r.therapist.split(', ').filter(Boolean)))];
  return {
    invoiceNo: invoice.invoiceNo,
    patientName: invoice.patientSnapshot.name,
    mrno: invoice.patientSnapshot.mrno,
    stayRows: admissionRows(invoice.clinicalSnapshot?.admission),
    rows,
    totalPaise: invoice.totalPaise,
    therapists: therapistNames,
  };
}

/** A bill that has a slip: it was issued for an inpatient stay. */
export function hasHospitalSlip(invoice: Pick<Invoice, 'clinicalSnapshot'>): boolean {
  const snap = invoice.clinicalSnapshot;
  return Boolean(snap?.admission) || snap?.placeOfService === 'ward';
}
