// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (q: () => unknown) => q() }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const setStatus = vi.fn();
const collectInvoiceNow = vi.fn();
vi.mock('@/services', () => ({
  repos: {
    visits: { get: () => undefined },
    consultationNotes: { getByVisitId: () => undefined, listByPatient: () => [] },
    treatmentCatalog: { list: () => [] },
  },
  invoiceService: {
    previewLineItems: async () => ({ lineItems: [], totalPaise: 50000 }),
    issueForVisit: async () => ({ id: 'inv-1', invoiceNo: 'BM/26-27/0001' }),
  },
  paymentService: {
    setStatus: (...a: unknown[]) => setStatus(...a),
    collectInvoiceNow: (...a: unknown[]) => collectInvoiceNow(...a),
  },
}));

import { IssueInvoiceDialog } from './IssueInvoiceDialog';

const target = { visitId: 'v1', patientId: 'p1', patientLabel: 'Ananya', serviceLabel: 'Physio', isPackage: false };

async function issueIt() {
  render(<IssueInvoiceDialog clinicId="c1" target={target} onClose={() => {}} returnTo="/ledger" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Review invoice' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm & issue' }));
}

describe('IssueInvoiceDialog payment status', () => {
  beforeEach(() => {
    setStatus.mockReset();
    collectInvoiceNow.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(cleanup);

  it('warns, and offers Retry, when the payment status could not be saved', async () => {
    collectInvoiceNow.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    await issueIt();
    expect(await screen.findByRole('alert')).toHaveTextContent(/payment status could not be saved/);
    expect(screen.getByRole('button', { name: 'Close anyway' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(collectInvoiceNow).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('shows no warning when the status saves', async () => {
    collectInvoiceNow.mockResolvedValue(undefined);
    await issueIt();
    expect(await screen.findByText(/BM\/26-27\/0001 issued/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
