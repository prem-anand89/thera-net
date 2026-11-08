// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttributionEntry } from '@/services/attributionAuditService';

const monthly = vi.fn();
// A stand-in for Dexie's live query: run the query once per dependency change and hand back its result.
vi.mock('dexie-react-hooks', async () => {
  const React = await import('react');
  return {
    useLiveQuery: <T,>(query: () => Promise<T> | T, deps: unknown[] = []) => {
      const [value, setValue] = React.useState<T | undefined>(undefined);
      React.useEffect(() => {
        let live = true;
        void Promise.resolve(query()).then((v) => live && setValue(v));
        return () => {
          live = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
      return value;
    },
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: { children: React.ReactNode; to: string; params?: { patientId?: string } }) => (
    <a href={to.replace('$patientId', params?.patientId ?? '')}>{children}</a>
  ),
}));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1', name: 'Clinic', invoicePrefix: 'BM' }) }));
vi.mock('@/app/usePermissions', () => ({ usePermissions: () => ({ canViewPayouts: true }) }));
vi.mock('@/services', () => ({
  attributionAuditService: { monthly: (...a: unknown[]) => monthly(...a) },
  repos: {
    therapists: {
      list: async () => [
        { id: 'me', name: 'Meera', active: true },
        { id: 'bm', name: 'BM', active: true },
      ],
    },
    patients: { list: async () => [{ id: 'p1', name: 'Sulochana' }] },
  },
}));

import { CreditsTab } from './CreditsTab';

afterEach(() => {
  cleanup();
  monthly.mockReset();
});

const entry: AttributionEntry = {
  mechanism: 'package_attribution',
  visitId: 'v1',
  visitDate: new Date().toISOString().slice(0, 10),
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
  billingVisitDate: null,
  repaired: false,
};

describe('CreditsTab', () => {
  it('shows a therapist their net, the colleague total, and an entry whose patient links to the profile', async () => {
    monthly.mockResolvedValue([entry]);
    render(<CreditsTab myTherapistId="me" isAdmin={false} />);
    expect(await screen.findByText('Net this month')).toBeInTheDocument();
    expect(screen.getAllByText('−₹1,800').length).toBeGreaterThan(0);
    expect(screen.getByText('To BM')).toBeInTheDocument();
    expect(screen.getByText('Package session 3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sulochana' })).toHaveAttribute('href', '/patients/p1');
    expect(screen.queryByLabelText('View')).not.toBeInTheDocument();
  });

  it('says what the month before had when this month is empty, and steps back on tap', async () => {
    monthly.mockImplementation(async (_c: string, m: { month: number }) => (m.month === new Date().getMonth() + 1 ? [] : [entry]));
    render(<CreditsTab myTherapistId="me" isAdmin={false} />);
    const hint = await screen.findByRole('button', { name: /had 1 entry/ });
    fireEvent.click(hint);
    expect(await screen.findByText('Entries · 1')).toBeInTheDocument();
  });

  it('gives an admin without a therapist row the whole-clinic table, and a tap opens a statement', async () => {
    monthly.mockResolvedValue([entry]);
    render(<CreditsTab isAdmin />);
    expect(await screen.findByText('Total moved')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Full audit/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'BM' }));
    await waitFor(() => expect(screen.getByText(/Net this month · BM/)).toBeInTheDocument());
  });
});
