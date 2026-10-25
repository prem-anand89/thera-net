// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Visit, VisitItem } from '@/domain/types';

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (q: () => unknown) => q() }));

const visitRef: { current: Partial<Visit> } = { current: {} };
const itemsRef: { current: VisitItem[] } = { current: [] };
const paymentsRef: { current: unknown[] } = { current: [] };
const updateBilling = vi.fn();
const updateLines = vi.fn();
const confirmAndDeleteVisitMock = vi.fn();

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => ({ id: 'c1', clinicType: 'group', enableTherapistSplit: true }),
}));
vi.mock('@/app/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: true, role: 'admin', canViewClinicalNotes: true, canBill: true }),
}));
vi.mock('@/app/useSession', () => ({
  useSession: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));
vi.mock('./confirmDeleteVisit', () => ({
  confirmAndDeleteVisit: (...a: unknown[]) => confirmAndDeleteVisitMock(...a),
}));
vi.mock('@/components/RevenueShareEditorLoader', () => ({
  RevenueShareEditorLoader: () => <div>share editor open</div>,
}));
vi.mock('@/services', () => ({
  repos: {
    visits: { get: () => visitRef.current },
    therapists: {
      list: () => [
        { id: 'p', clinicId: 'c1', name: 'Dr Raghavender', active: true },
        { id: 's', clinicId: 'c1', name: 'Dr Sneha', active: true },
      ],
    },
    invoices: { get: () => ({ id: 'inv1', invoiceNo: 'INV-7' }) },
    patients: { get: () => ({ id: 'pt1', name: 'Ananya', mrno: 'MR-001' }) },
    catalog: {
      get: () => ({ id: 'a1', name: 'Assessment' }),
      list: () => [
        { id: 'a1', clinicId: 'c1', name: 'Assessment', basePricePaise: 100000, sessionCount: 1, active: true },
        { id: 'b2', clinicId: 'c1', name: 'Dry needling', basePricePaise: 30000, sessionCount: 1, active: true },
      ],
    },
    visitItems: { listByVisitIds: () => itemsRef.current },
    visitCredits: { listByVisitIds: () => [] },
    payments: { listByVisit: () => paymentsRef.current },
    treatmentCatalog: { list: () => [] },
  },
  visitService: {
    updateBilling: (...a: unknown[]) => updateBilling(...a),
    updateLines: (...a: unknown[]) => updateLines(...a),
  },
  dashboardService: { treatmentUsageCounts: () => [] },
}));

import { EditVisitModal } from './EditVisitModal';

const line = (id: string, name: string, price: number, assist: string | null, pos: number): VisitItem => ({
  id,
  clinicId: 'c1',
  visitId: 'v1',
  position: pos,
  serviceCatalogId: id,
  serviceName: name,
  catalogPricePaise: price,
  pricePaise: price,
  assistingTherapistId: assist,
  durationMinutes: null,
  isPackageLine: false,
  deleted: false,
  updatedAt: '',
});

const askConfirmMock = vi.fn(async () => true);
vi.mock('@/lib/notify', () => ({
  askConfirm: (...a: unknown[]) => askConfirmMock(...(a as [])),
  notify: { error: vi.fn(), info: vi.fn() },
}));

const setErrorMock = vi.fn();
const onCloseMock = vi.fn();
function setup(visit: Partial<Visit>, items: VisitItem[], onClose = onCloseMock) {
  visitRef.current = {
    id: 'v1',
    clinicId: 'c1',
    patientId: 'pt1',
    therapistId: 'p',
    visitDate: '2026-10-20',
    serviceCatalogId: 'a1',
    catalogPricePaise: 130000,
    actualBillPaise: 130000,
    adjustmentPaise: 0,
    invoiceId: null,
    ...visit,
  };
  itemsRef.current = items;
  render(<EditVisitModal visitId="v1" onClose={onClose} setError={setErrorMock} />);
}

beforeEach(() => {
  updateBilling.mockReset().mockResolvedValue({ sharesOutdated: false });
  setErrorMock.mockReset();
  onCloseMock.mockReset();
  askConfirmMock.mockReset().mockResolvedValue(true);
  updateLines.mockReset().mockResolvedValue({ sharesOutdated: false });
});
afterEach(cleanup);

const items = [line('a1', 'Assessment', 100000, null, 0), line('b2', 'Dry needling', 30000, 's', 1)];

describe('EditVisitModal', () => {
  it('invoiced visit shows services locked and share editable', () => {
    setup({ invoiceId: 'inv1' }, items);
    expect(screen.getByText(/Locked on Invoice #INV-7/)).toBeInTheDocument();
    expect(screen.getByText(/Services and billing are locked/)).toBeInTheDocument();
    expect(screen.getByText(/Dry needling/)).toBeInTheDocument();
    expect(screen.getByText(/done by Dr Sneha/)).toBeInTheDocument();
    // no service editing controls, no bill adjustment, no therapist/date fields
    expect(screen.queryByText('+ Add another service')).toBeNull();
    expect(screen.queryByLabelText('Visit date')).toBeNull();
    expect(screen.getByText("Does not change the patient's bill.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit split' }));
    expect(screen.getByText('share editor open')).toBeInTheDocument();
  });

  it('an uninvoiced visit with services saves them through updateLines', async () => {
    setup({}, items);
    // With nothing adjusted the single Total says it all (no separate Subtotal box).
    expect(screen.queryByText(/Subtotal/)).toBeNull();
    expect(screen.getByText(/Total: /)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(updateBilling).toHaveBeenCalled());
    // nothing about the services or bill changed, so they are not rewritten
    expect(updateLines).not.toHaveBeenCalled();
  });

  it('a visit without services keeps the single-bill editor', () => {
    setup({}, []);
    expect(screen.queryByText(/Subtotal/)).toBeNull();
    expect(screen.getByText(/Catalog — Assessment/)).toBeInTheDocument();
  });

  it('saving an invoiced visit never calls updateLines', async () => {
    setup({ invoiceId: 'inv1' }, items);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(updateBilling).toHaveBeenCalledTimes(1));
    expect(updateBilling.mock.calls[0][1]).toEqual({ condition: null, treatmentNotes: null, treatmentIds: [] });
    expect(updateLines).not.toHaveBeenCalled();
  });

  it('refuses to save when the visit was invoiced after the editor opened, before any write', async () => {
    setup({}, items);
    visitRef.current = { ...visitRef.current, invoiceId: 'inv9' };
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(setErrorMock).toHaveBeenCalled());
    expect(updateBilling).not.toHaveBeenCalled();
    expect(updateLines).not.toHaveBeenCalled();
  });

  it('displays error note inside the dialog when save fails', async () => {
    updateBilling.mockRejectedValueOnce(new Error('Network error during save'));
    setup({}, items);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(screen.getByText('Network error during save')).toBeInTheDocument();
    });
  });

  it('closes immediately on Cancel when untouched', async () => {
    setup({}, items, onCloseMock);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(askConfirmMock).not.toHaveBeenCalled();
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('prompts to discard unsaved changes when modified', async () => {
    setup({}, items, onCloseMock);
    const conditionInput = screen.getByPlaceholderText('e.g., Cervical pain');
    fireEvent.change(conditionInput, { target: { value: 'Severe back pain' } });

    // Try to cancel but decline discard
    askConfirmMock.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(askConfirmMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Discard unsaved changes?' })
      );
    });
    expect(onCloseMock).not.toHaveBeenCalled();

    // Now confirm discard
    askConfirmMock.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(onCloseMock).toHaveBeenCalledTimes(1);
    });
  });

  it('warns when changing visit date moves visit into another month', () => {
    setup({ visitDate: '2026-10-20' }, items);
    const dateInput = screen.getByLabelText('Visit date');
    fireEvent.change(dateInput, { target: { value: '2026-11-05' } });
    expect(screen.getByText("This moves the visit into November's report.")).toBeInTheDocument();
  });

  it('displays payment status with partial payment', () => {
    paymentsRef.current = [
      { id: 'pay1', visitId: 'v1', amountPaise: 50000, method: 'upi', deleted: false },
    ];
    setup({ actualBillPaise: 130000 }, items);
    expect(screen.getByText(/Paid ₹500 · ₹800 more to collect/)).toBeInTheDocument();
    expect(screen.getByText('· Paid ₹500')).toBeInTheDocument();
    paymentsRef.current = [];
  });

  it('calls confirmAndDeleteVisit when Delete this visit is clicked', async () => {
    setup({}, items, onCloseMock);
    const deleteBtn = screen.getByRole('button', { name: 'Delete this visit' });
    fireEvent.click(deleteBtn);
    await vi.waitFor(() => {
      expect(confirmAndDeleteVisitMock).toHaveBeenCalledWith('v1');
    });
  });
});
