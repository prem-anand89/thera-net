// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// An async query (the dialog reads every visit on the invoice) reads as "still loading" here, as it does on first render.
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (q: () => unknown) => {
    const result = q();
    return result instanceof Promise ? undefined : result;
  },
}));
const perms = { isAdmin: true };
vi.mock('@/app/usePermissions', () => ({ usePermissions: () => ({ canViewClinicalNotes: true, isAdmin: perms.isAdmin }) }));
const clinicRow = { current: { id: 'c1', address: '12 MG Road' } as { id: string; address: string | null } };
const putClinic = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const setStatus = vi.fn();
const collectInvoiceNow = vi.fn();
const issueForVisit = vi.fn(async () => ({ id: 'inv-1', invoiceNo: 'BM/26-27/0001' }));
const issueForVisits = vi.fn(async () => ({ id: 'inv-2', invoiceNo: 'BM/26-27/0002' }));
const previewLineItems = vi.fn(async () => ({ lineItems: [], totalPaise: 50000 }));
vi.mock('@/services', () => ({
  repos: {
    visits: { get: () => undefined },
    clinics: { get: () => clinicRow.current, put: (...a: unknown[]) => putClinic(...a) },
    consultationNotes: { getByVisitId: () => undefined, listByPatient: () => [] },
    treatmentCatalog: { list: () => [] },
  },
  invoiceService: {
    visitsOnInvoice: async () => [],
    previewLineItems: (...a: unknown[]) => (previewLineItems as (...x: unknown[]) => unknown)(...a),
    issueForVisit: (...a: unknown[]) => (issueForVisit as (...x: unknown[]) => unknown)(...a),
    issueForVisits: (...a: unknown[]) => (issueForVisits as (...x: unknown[]) => unknown)(...a),
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
    expect(await screen.findByRole('alert')).toHaveTextContent(/payment could not be recorded/);
    expect(screen.getByRole('button', { name: 'Close anyway' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(collectInvoiceNow).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('marks the invoice outstanding before recording cash, so a failure never leaves it reading as paid', async () => {
    collectInvoiceNow.mockRejectedValue(new Error('offline'));
    await issueIt();
    await screen.findByRole('alert');
    expect(setStatus).toHaveBeenCalledWith('inv-1', 'c1', 'outstanding');
    expect(setStatus.mock.invocationCallOrder[0]).toBeLessThan(collectInvoiceNow.mock.invocationCallOrder[0]);
  });

  it('shows no warning when the status saves', async () => {
    collectInvoiceNow.mockResolvedValue(undefined);
    await issueIt();
    expect(await screen.findByText(/BM\/26-27\/0001 issued/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('IssueInvoiceDialog with several visits', () => {
  beforeEach(() => {
    issueForVisit.mockClear();
    issueForVisits.mockClear();
    previewLineItems.mockClear();
    collectInvoiceNow.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it('previews and issues one invoice for all the selected visits, then collects it', async () => {
    const multi = { ...target, visitIds: ['v1', 'v2', 'v3'], serviceLabel: '3 visits' };
    render(<IssueInvoiceDialog clinicId="c1" target={multi} onClose={() => {}} returnTo="/patients" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Review invoice' }));
    expect(previewLineItems).toHaveBeenCalledWith(['v1', 'v2', 'v3']);
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm & issue' }));
    expect(issueForVisits).toHaveBeenCalledWith(['v1', 'v2', 'v3'], 'UPI', null);
    expect(issueForVisit).not.toHaveBeenCalled();
    expect(collectInvoiceNow).toHaveBeenCalledTimes(1);
  });
});

describe('IssueInvoiceDialog missing clinic address', () => {
  afterEach(() => {
    cleanup();
    clinicRow.current = { id: 'c1', address: '12 MG Road' };
    perms.isAdmin = true;
    putClinic.mockReset();
  });
  const open = () => render(<IssueInvoiceDialog clinicId="c1" target={target} onClose={() => {}} returnTo="/ledger" />);

  it('shows nothing when the clinic has an address', async () => {
    open();
    expect(await screen.findByRole('button', { name: 'Review invoice' })).toBeEnabled();
    expect(screen.queryByTestId('address-missing')).toBeNull();
  });

  it('an admin is asked for the address in place, and cannot review until it is saved', async () => {
    clinicRow.current = { id: 'c1', address: null };
    open();
    expect(await screen.findByTestId('address-missing')).toHaveTextContent(/prints on every bill/);
    expect(screen.getByRole('button', { name: 'Review invoice' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Clinic address'), '12 MG Road, Pune');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(putClinic).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', address: '12 MG Road, Pune' }));
  });

  it('someone who cannot edit the clinic is told who to ask, and is not held up', async () => {
    clinicRow.current = { id: 'c1', address: '  ' };
    perms.isAdmin = false;
    open();
    expect(await screen.findByTestId('address-missing')).toHaveTextContent(/Ask an admin/);
    expect(screen.getByRole('button', { name: 'Review invoice' })).toBeEnabled();
  });
});
