import { describe, expect, it } from 'vitest';
import type { AttributionEntry } from '@/services/attributionAuditService';
import { myRows } from '@/features/reports/attributionAuditView';
import { clinicTotals, colleagueTotals, creditLines, creditsSummary } from './creditsView';

const names: Record<string, string> = { me: 'Meera', bm: 'BM', ai: 'Aishwarya', rv: 'Ravi' };
const nameOf = (id: string) => names[id] ?? id;
const entry = (over: Partial<AttributionEntry>): AttributionEntry => ({
  mechanism: 'package_attribution',
  visitId: 'v1',
  visitDate: '2026-11-08',
  patientId: 'p1',
  fromTherapistId: 'me',
  toTherapistId: 'bm',
  grossPaise: null,
  postTaxPaise: 180000,
  packageGroupId: 'g',
  sharedPct: null,
  visitBillPaise: null,
  packageTotalPaise: 540000,
  packageSessionCount: 3,
  sessionIndex: 3,
  billingVisitDate: '2026-08-21',
  repaired: false,
  ...over,
});

const entries: AttributionEntry[] = [
  entry({ visitId: 'v1' }), // I owe BM: debit 1,800
  entry({ visitId: 'v2', visitDate: '2026-11-07', fromTherapistId: 'ai', toTherapistId: 'me', postTaxPaise: 171400, sessionIndex: 3, packageSessionCount: 7, billingVisitDate: '2026-08-20' }),
  entry({ visitId: 'v3', visitDate: '2026-11-06', mechanism: 'manual_split', fromTherapistId: 'ai', toTherapistId: 'me', postTaxPaise: 30000, sharedPct: 40, billingVisitDate: null }),
  entry({ visitId: 'v4', visitDate: '2026-11-05', mechanism: 'line_share', fromTherapistId: 'me', toTherapistId: 'rv', postTaxPaise: 45000, billingVisitDate: null }),
];

describe('creditLines', () => {
  const lines = creditLines(myRows(entries, 'me'), { subjectId: 'me', isSelf: true, nameOf });

  it('words each kind of entry: package session, share set by hand, share of the visit', () => {
    expect(lines.map((l) => l.reason)).toEqual(['Package session 3 of 3', 'Package session 3 of 7', '40% share', 'Share of the visit']);
    expect(lines[0].detail).toBe('8 Nov · done by BM · package billed 21 Aug');
    expect(lines[1].detail).toBe('7 Nov · done by you · package billed 20 Aug');
    expect(lines[2].detail).toBe('6 Nov · set by hand');
    expect(lines[3].detail).toBe('5 Nov');
  });

  it('points each line at the colleague and the direction of the money', () => {
    expect(lines.map((l) => [l.direction, l.colleagueId])).toEqual([['to', 'bm'], ['from', 'ai'], ['from', 'ai'], ['to', 'rv']]);
  });

  it('says "you helped" for the helper part, and names the therapist when an admin views a colleague', () => {
    const helper = creditLines(myRows([entry({ fromTherapistId: 'ai', toTherapistId: 'me', packageRole: 'helper' })], 'me'), { subjectId: 'me', isSelf: true, nameOf });
    expect(helper[0].detail).toContain('you helped');
    const asAdmin = creditLines(myRows(entries, 'me'), { subjectId: 'me', isSelf: false, nameOf });
    expect(asAdmin[1].detail).toBe('7 Nov · done by Meera · package billed 20 Aug');
  });
});

describe('totals', () => {
  const rows = myRows(entries, 'me');
  it('adds credits, debits and the net (negative when more went out)', () => {
    expect(creditsSummary(rows)).toEqual({ credits: 201400, debits: 225000, net: -23600 });
  });
  it('nets each colleague, biggest movement first', () => {
    expect(colleagueTotals(rows)).toEqual([
      { colleagueId: 'ai', netPaise: 201400, count: 2 },
      { colleagueId: 'bm', netPaise: -180000, count: 1 },
      { colleagueId: 'rv', netPaise: -45000, count: 1 },
    ]);
  });
  it('gives the clinic view each therapist gave, received and net, and the total moved', () => {
    const t = clinicTotals(entries);
    expect(t.movedPaise).toBe(180000 + 171400 + 30000 + 45000);
    expect(t.rows.find((r) => r.therapistId === 'me')).toEqual({ therapistId: 'me', gave: 225000, received: 201400, net: -23600 });
    expect(t.rows.reduce((s, r) => s + r.net, 0)).toBe(0);
    expect(t.rows[0].therapistId).toBe('ai');
  });
  it('is all zero for no entries', () => {
    expect(creditsSummary([])).toEqual({ credits: 0, debits: 0, net: 0 });
    expect(clinicTotals([])).toEqual({ rows: [], movedPaise: 0 });
  });
});
