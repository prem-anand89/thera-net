// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { InvoicesPage } from './InvoicesPage';

const needsReceiptRows = [
  { visitId: 'v1', patientName: 'Asha', mrno: 'P1', visitDate: '2026-11-01', collectedPaise: 50000, therapistName: 'Dr X', serviceName: 'Session' },
];

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (q: () => unknown) => q() }));
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
vi.mock('@/services', () => ({
  repos: {
    invoices: { list: () => [] },
    invoicePayments: { list: () => [] },
    visits: { list: () => [] },
    payments: { list: () => [] },
    patients: { list: () => [] },
  },
  paymentService: { invoiceBalance: () => undefined },
  dashboardService: { needsReceipt: () => needsReceiptRows },
}));

afterEach(cleanup);

describe('InvoicesPage on a plan that no longer issues invoices', () => {
  it('shows the "Needs receipt" queue when invoices can be issued', () => {
    render(<InvoicesPage />);
    expect(screen.getByText(/Needs receipt \(1\)/)).toBeInTheDocument();
  });

  it('hides it, and the "issue one from a visit" hint, when canIssue is false', () => {
    render(<InvoicesPage canIssue={false} />);
    expect(screen.queryByText(/Needs receipt/)).toBeNull();
    expect(screen.queryByText(/Issue one from a visit/)).toBeNull();
  });
});
