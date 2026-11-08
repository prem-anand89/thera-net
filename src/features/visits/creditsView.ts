import { formatExpiryDate } from '@/domain/packageTracking';
import type { Paise } from '@/domain/money';
import type { UUID } from '@/domain/types';
import type { AttributionEntry } from '@/services/attributionAuditService';
import { summarize, type MyAuditRow } from '@/features/reports/attributionAuditView';

/** One entry on a therapist's credits statement, worded for a person (never a bill amount or a package price). */
export interface CreditLine {
  key: string;
  patientId: UUID;
  visitId: UUID;
  signedPaise: Paise;
  direction: 'from' | 'to';
  colleagueId: UUID;
  /** The reason, short: "Package session 3 of 7", "40% share", "Share of the visit". */
  reason: string;
  /** One quiet line: date, who did the work, when a package was billed, "set by hand". */
  detail: string;
}

/**
 * `subjectId`'s rows as statement lines. `isSelf` says whether the viewer is that therapist: a person reads "done by you",
 * an admin looking at a colleague's statement reads "done by Ravi".
 */
export function creditLines(
  rows: MyAuditRow[],
  opts: { subjectId: UUID; isSelf: boolean; nameOf: (id: UUID) => string }
): CreditLine[] {
  const who = (id: UUID) => (opts.isSelf && id === opts.subjectId ? 'you' : opts.nameOf(id));
  return rows.map((r, i) => {
    const e = r.entry;
    const parts: string[] = [formatExpiryDate(e.visitDate)];
    let reason: string;
    if (e.mechanism === 'package_attribution') {
      reason = `Package session ${e.sessionIndex ?? '?'} of ${e.packageSessionCount ?? '?'}`;
      parts.push(e.packageRole === 'helper' ? `${who(e.toTherapistId)} helped` : `done by ${who(e.toTherapistId)}`);
      if (e.billingVisitDate) parts.push(`package billed ${formatExpiryDate(e.billingVisitDate)}`);
    } else if (e.mechanism === 'manual_split') {
      reason = `${e.sharedPct ?? '?'}% share`;
      parts.push('set by hand');
    } else {
      reason = 'Share of the visit';
    }
    return {
      key: `${e.visitId}-${e.mechanism}-${i}`,
      patientId: e.patientId,
      visitId: e.visitId,
      signedPaise: r.signedPaise,
      direction: r.signedPaise > 0 ? 'from' : 'to',
      colleagueId: r.withTherapistId,
      reason,
      detail: parts.join(' · '),
    };
  });
}

export function creditsSummary(rows: MyAuditRow[]): { credits: Paise; debits: Paise; net: Paise } {
  const credits = rows.filter((r) => r.signedPaise > 0).reduce((s, r) => s + r.signedPaise, 0);
  const debits = rows.filter((r) => r.signedPaise < 0).reduce((s, r) => s - r.signedPaise, 0);
  return { credits, debits, net: credits - debits };
}

/** Net per colleague (positive = they sent you money), the biggest movement first. */
export function colleagueTotals(rows: MyAuditRow[]): { colleagueId: UUID; netPaise: Paise; count: number }[] {
  const m = new Map<UUID, { netPaise: Paise; count: number }>();
  for (const r of rows) {
    const cur = m.get(r.withTherapistId) ?? { netPaise: 0, count: 0 };
    cur.netPaise += r.signedPaise;
    cur.count += 1;
    m.set(r.withTherapistId, cur);
  }
  return [...m]
    .map(([colleagueId, v]) => ({ colleagueId, ...v }))
    .sort((a, b) => Math.abs(b.netPaise) - Math.abs(a.netPaise) || a.colleagueId.localeCompare(b.colleagueId));
}

/** The whole clinic's month for the admin: each therapist's gave, received and net, the biggest net first, and the total moved. */
export function clinicTotals(entries: AttributionEntry[]): {
  rows: { therapistId: UUID; gave: Paise; received: Paise; net: Paise }[];
  movedPaise: Paise;
} {
  const rows = summarize(entries)
    .map((s) => ({ therapistId: s.therapistId, gave: s.given, received: s.received, net: s.received - s.given }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.therapistId.localeCompare(b.therapistId));
  return { rows, movedPaise: rows.reduce((s, r) => s + r.gave, 0) };
}
