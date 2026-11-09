// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Invoice, Visit } from '@/domain/types';

let mockVisits: Visit[] = [];
let mockCatalog: { id: string; name: string }[] = [{ id: 's1', name: 'Physio' }];

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (q: () => unknown) => {
    const res = q();
    return res instanceof Promise ? [] : res;
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock('@/services', () => ({
  repos: {
    visits: { list: () => mockVisits },
    catalog: { list: () => mockCatalog },
  },
  invoiceService: {
    amendInvoice: vi.fn(),
  },
}));

import { AmendInvoiceDialog } from './AmendInvoiceDialog';

describe('AmendInvoiceDialog department scoping', () => {
  afterEach(cleanup);

  it('only offers uninvoiced visits from the same department as the original invoice', () => {
    const originalInvoice = {
      id: 'inv-1',
      clinicId: 'c1',
      invoiceNo: 'BM/26-27/0001',
      paymentMode: 'Cash',
      clinicalSnapshot: { placeOfService: 'clinic' },
    } as unknown as Invoice;

    mockVisits = [
      {
        id: 'v-orig',
        clinicId: 'c1',
        patientId: 'p1',
        visitDate: '2026-08-01',
        serviceCatalogId: 's1',
        actualBillPaise: 50000,
        invoiceId: 'inv-1',
        location: 'clinic',
        deleted: false,
      } as Visit,
      {
        id: 'v-op-unbilled',
        clinicId: 'c1',
        patientId: 'p1',
        visitDate: '2026-08-02',
        serviceCatalogId: 's1',
        actualBillPaise: 50000,
        invoiceId: null,
        location: 'clinic',
        deleted: false,
      } as Visit,
      {
        id: 'v-home-unbilled',
        clinicId: 'c1',
        patientId: 'p1',
        visitDate: '2026-08-03',
        serviceCatalogId: 's1',
        actualBillPaise: 80000,
        invoiceId: null,
        location: 'home',
        deleted: false,
      } as Visit,
      {
        id: 'v-ward-unbilled',
        clinicId: 'c1',
        patientId: 'p1',
        visitDate: '2026-08-04',
        serviceCatalogId: 's1',
        actualBillPaise: 120000,
        invoiceId: null,
        location: 'ward',
        deleted: false,
      } as Visit,
    ];

    render(
      <AmendInvoiceDialog
        clinicId="c1"
        invoice={originalInvoice}
        onClose={() => {}}
        returnTo="/ledger"
      />
    );

    expect(screen.getByText(/Add uninvoiced visits for this patient/i)).toBeInTheDocument();
    // 02/08 (OP) should be shown
    expect(screen.getByText(/02\/08 — Physio/i)).toBeInTheDocument();
    // 03/08 (Home) and 04/08 (Ward) should NOT be offered for an OP invoice
    expect(screen.queryByText(/03\/08 — Physio/i)).toBeNull();
    expect(screen.queryByText(/04\/08 — Physio/i)).toBeNull();
  });
});
