// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Visit, VisitItem } from '@/domain/types';

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (q: () => unknown) => q() }));

const visitRef: { current: Partial<Visit> } = { current: {} };
const itemsRef: { current: VisitItem[] } = { current: [] };
const updateBilling = vi.fn();
const updateLines = vi.fn();

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => ({ id: 'c1', clinicType: 'group', enableTherapistSplit: true }),
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
    patients: { get: () => ({ id: 'pt1', name: 'Ananya' }) },
    catalog: {
      get: () => ({ id: 'a1', name: 'Assessment' }),
      list: () => [
        { id: 'a1', clinicId: 'c1', name: 'Assessment', basePricePaise: 100000, sessionCount: 1, active: true },
        { id: 'b2', clinicId: 'c1', name: 'Dry needling', basePricePaise: 30000, sessionCount: 1, active: true },
      ],
    },
    visitItems: { listByVisitIds: () => itemsRef.current },
    visitCredits: { listByVisitIds: () => [] },
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

function setup(visit: Partial<Visit>, items: VisitItem[]) {
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
  render(<EditVisitModal visitId="v1" onClose={() => {}} setError={() => {}} />);
}

beforeEach(() => {
  updateBilling.mockReset().mockResolvedValue({ sharesOutdated: false });
  updateLines.mockReset().mockResolvedValue({ sharesOutdated: false });
});
afterEach(cleanup);

const items = [line('a1', 'Assessment', 100000, null, 0), line('b2', 'Dry needling', 30000, 's', 1)];

describe('EditVisitModal', () => {
  it('invoiced visit shows services locked and share editable', () => {
    setup({ invoiceId: 'inv1' }, items);
    expect(screen.getByText("This visit is on an invoice. Its services and bill can't be changed.")).toBeInTheDocument();
    expect(screen.getByText(/Dry needling/)).toBeInTheDocument();
    expect(screen.getByText(/Dr Sneha assisting/)).toBeInTheDocument();
    // no service editing controls, no bill adjustment, no therapist/date fields
    expect(screen.queryByText('+ Add another service')).toBeNull();
    expect(screen.queryByLabelText('Visit date')).toBeNull();
    expect(screen.getByText("Does not change the patient's bill.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit split' }));
    expect(screen.getByText('share editor open')).toBeInTheDocument();
  });

  it('an uninvoiced visit with services saves them through updateLines', async () => {
    setup({}, items);
    expect(screen.getAllByText(/Subtotal/).length).toBeGreaterThan(0);
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
});
