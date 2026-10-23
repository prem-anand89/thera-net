// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Visit, VisitCredit, VisitItem } from '@/domain/types';
import { assistedVisitsFor } from './assistedVisits';
import { AssistedVisitList, assistedShareText } from './AssistedVisitList';
import { summariseTotals } from './ledgerTotals';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => <a className={className}>{children}</a>,
}));

afterEach(cleanup);

const nameOf = (id: string) => ({ prem: 'Dr Prem', ravi: 'Dr Ravi' })[id] ?? 'Therapist';
const visit = (id: string, therapistId: string, over: Partial<Visit> = {}): Visit =>
  ({ id, clinicId: 'c1', patientId: 'p1', therapistId, visitDate: '2026-06-10', actualBillPaise: 130000, deleted: false, ...over }) as Visit;
const line = (id: string, visitId: string, name: string, position: number, assistingTherapistId: string | null, deleted = false): VisitItem =>
  ({ id, visitId, serviceName: name, position, assistingTherapistId, deleted }) as VisitItem;
const credit = (visitId: string, therapistId: string, amountPaise: number): VisitCredit =>
  ({ id: `${visitId}-${therapistId}`, visitId, therapistId, amountPaise, deleted: false }) as VisitCredit;

const visits = [visit('v1', 'prem'), visit('v2', 'ravi'), visit('v3', 'prem')];
const items = [
  line('l1', 'v1', 'Assessment', 0, null),
  line('l2', 'v1', 'Dry needling', 1, 'ravi'),
  line('l3', 'v2', 'Own visit', 0, null),
  line('l4', 'v3', 'Taping', 0, 'ravi', true), // deleted line: not assisted
];
const credits = [credit('v1', 'prem', 86700), credit('v1', 'ravi', 43300)];

describe('assistedVisitsFor', () => {
  it('assisted row shows only the assistant\'s share', () => {
    const rows = assistedVisitsFor('ravi', visits, items, credits, nameOf, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      visitId: 'v1',
      services: ['Dry needling'],
      primaryName: 'Dr Prem',
      sharePaise: 43300,
    });
    // The whole bill and the primary's share are not part of what the assistant is given.
    expect(JSON.stringify(rows[0])).not.toContain('130000');
    expect(JSON.stringify(rows[0])).not.toContain('86700');
  });

  it('split off shows revenue not shared', () => {
    const rows = assistedVisitsFor('ravi', visits, items, credits, nameOf, false);
    expect(rows[0].sharePaise).toBeNull();
    expect(assistedShareText(rows[0].sharePaise)).toBe('revenue not shared');
  });

  it('a visit with no share row for the assistant shows revenue not shared; the primary never sees their own visit as assisted', () => {
    expect(assistedVisitsFor('ravi', visits, items, [], nameOf, true)[0].sharePaise).toBeNull();
    expect(assistedVisitsFor('prem', visits, items, credits, nameOf, true)).toEqual([]);
  });

  it('assisted visit is not in the assistant\'s dues or ledger totals', () => {
    // The Ledger totals are built from the therapist-filtered visit list (primary visits only);
    // the assisted row is a different list and carries no bill at all.
    const ravisOwn = visits.filter((v) => v.therapistId === 'ravi');
    const totals = summariseTotals(ravisOwn.map((v) => ({ billPaise: v.actualBillPaise, paymentState: 'uninvoiced' as const })));
    expect(totals.visitCount).toBe(1);
    expect(totals.bill).toBe(130000);
    const assisted = assistedVisitsFor('ravi', visits, items, credits, nameOf, true);
    expect(assisted.map((a) => a.visitId)).not.toContain('v2');
    expect(Object.keys(assisted[0])).not.toContain('billPaise');
  });
});

describe('AssistedVisitList', () => {
  it('shows pill, primary, share and schedule note, with no Collect or invoice controls', () => {
    const rows = assistedVisitsFor('ravi', visits, items, credits, nameOf, true);
    render(<AssistedVisitList rows={rows} patientName={() => 'Asha'} />);
    expect(screen.getByText('Assisted')).toBeInTheDocument();
    expect(screen.getByText('with Dr Prem')).toBeInTheDocument();
    expect(screen.getByText('Your share ₹433')).toBeInTheDocument();
    expect(screen.getByText("Not on your schedule. Logged on Dr Prem's visit.")).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/collect/i)).toBeNull();
    expect(screen.queryByText(/credit/i)).toBeNull();
  });
});
