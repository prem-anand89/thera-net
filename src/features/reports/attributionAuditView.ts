import { formatINR, type Paise } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import type { UUID } from '@/domain/types';
import type { AttributionEntry } from '@/services/attributionAuditService';

export const MECHANISM_LABEL: Record<AttributionEntry['mechanism'], string> = {
  line_share: 'Revenue share',
  manual_split: 'Manual split',
  package_attribution: 'Package attribution',
};

/** What the moved amount is a share of, in words. */
export function basisText(e: AttributionEntry, nameOf: (id: UUID) => string): string {
  switch (e.mechanism) {
    case 'manual_split':
      return `${e.sharedPct}% of ${formatINR(e.visitBillPaise ?? 0)} bill`;
    case 'line_share':
      return `Share of ${formatINR(e.visitBillPaise ?? 0)} bill`;
    case 'package_attribution':
      return (
        `Session ${e.sessionIndex ?? '?'} of ${e.packageSessionCount ?? '?'} · run by ${nameOf(e.toTherapistId)}` +
        ` · from ${nameOf(e.fromTherapistId)}'s ${formatINR(e.packageTotalPaise ?? 0)} package` +
        (e.billingVisitDate ? ` billed ${formatDateDMY(e.billingVisitDate)}` : '')
      );
  }
}

/** Entries where `therapistId` gave or received money, and whose patient name contains `query`. */
export function filterEntries(
  entries: AttributionEntry[],
  opts: { therapistId?: UUID | ''; query?: string; patientName: (id: UUID) => string }
): AttributionEntry[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  return entries.filter(
    (e) =>
      (!opts.therapistId || e.fromTherapistId === opts.therapistId || e.toTherapistId === opts.therapistId) &&
      (!q || opts.patientName(e.patientId).toLowerCase().includes(q))
  );
}

/** Per therapist: post-tax money given away and received. The two columns net to each therapist's Net change. */
export function summarize(entries: AttributionEntry[]): { therapistId: UUID; given: Paise; received: Paise }[] {
  const m = new Map<UUID, { given: Paise; received: Paise }>();
  const row = (id: UUID) => {
    if (!m.has(id)) m.set(id, { given: 0, received: 0 });
    return m.get(id)!;
  };
  for (const e of entries) {
    row(e.fromTherapistId).given += e.postTaxPaise;
    row(e.toTherapistId).received += e.postTaxPaise;
  }
  return [...m].map(([therapistId, v]) => ({ therapistId, ...v }));
}

const csvCell = (v: string | number) => {
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function toAuditCsv(
  entries: AttributionEntry[],
  nameOf: (id: UUID) => string,
  patientName: (id: UUID) => string
): string {
  const rows = [
    ['Date', 'Patient', 'From', 'To', 'Mechanism', 'Basis', 'Gross (₹)', 'Post-tax (₹)'],
    ...entries.map((e) => [
      e.visitDate,
      patientName(e.patientId),
      nameOf(e.fromTherapistId),
      nameOf(e.toTherapistId),
      MECHANISM_LABEL[e.mechanism] + (e.repaired ? ' (repaired)' : ''),
      basisText(e, nameOf),
      e.grossPaise == null ? '' : e.grossPaise / 100,
      e.postTaxPaise / 100,
    ]),
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
