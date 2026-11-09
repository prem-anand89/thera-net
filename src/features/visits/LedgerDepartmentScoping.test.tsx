// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Department } from '@/domain/departments';
import type { Invoice, Patient, Payment, PaymentStatus, Therapist, Visit } from '@/domain/types';
import type { AttributionEntry } from '@/services/attributionAuditService';

let currentDept: Department = 'clinic';
vi.mock('@/app/DepartmentContext', () => ({
  useDepartment: () => ({
    department: currentDept,
    departments: ['clinic', 'home', 'ward'],
    canSwitch: true,
    setDepartment: (d: Department) => {
      currentDept = d;
    },
  }),
}));

const mockClinic = {
  id: 'c1',
  name: 'Physio Clinic',
  invoicePrefix: 'BM',
  careLocations: ['clinic', 'home', 'ward'],
  slotDurationMinutes: 30,
};
vi.mock('@/app/clinicContext', () => ({
  useClinic: () => mockClinic,
}));

vi.mock('@/app/usePermissions', () => ({
  usePermissions: () => ({
    canBill: true,
    canViewPastInvoices: true,
    canCollectPayment: true,
    canShareRevenue: true,
    canViewPayouts: true,
    entitlementsLoading: false,
    invoicingOnPlan: true,
  }),
}));

vi.mock('@/app/useWorkspaceScope', () => ({
  useWorkspaceScope: () => ({
    isAdmin: true,
    isFrontDesk: false,
    myTherapistId: 'th-1',
    isClinicWideView: true,
    scopeTherapistId: null,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, search, params }: { children: React.ReactNode; to?: string; search?: unknown; params?: Record<string, string> }) => (
    <a href={to ?? '#'} data-search={JSON.stringify(search)} data-params={JSON.stringify(params)}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useSearch: () => ({ tab: 'visits' }),
}));

const mockVisits: Visit[] = [
  {
    id: 'v-op-1',
    clinicId: 'c1',
    patientId: 'p-1',
    therapistId: 'th-1',
    serviceCatalogId: 's1',
    visitDate: '2026-11-09',
    actualBillPaise: 50000,
    adjustmentPaise: 0,
    adjustmentReason: null,
    location: 'clinic',
    treatmentIds: [],
    sessionIndex: null,
    packageTotal: null,
    packageGroupId: null,
    invoiceId: null,
    sharedPct: null,
    sharedTherapistId: null,
    deleted: false,
    updatedAt: '2026-11-09T08:00:00Z',
  },
  {
    id: 'v-home-1',
    clinicId: 'c1',
    patientId: 'p-2',
    therapistId: 'th-1',
    serviceCatalogId: 's1',
    visitDate: '2026-11-09',
    actualBillPaise: 60000,
    adjustmentPaise: 0,
    adjustmentReason: null,
    location: 'home',
    treatmentIds: [],
    sessionIndex: null,
    packageTotal: null,
    packageGroupId: null,
    invoiceId: null,
    sharedPct: null,
    sharedTherapistId: null,
    deleted: false,
    updatedAt: '2026-11-09T08:00:00Z',
  },
  {
    id: 'v-ward-1',
    clinicId: 'c1',
    patientId: 'p-3',
    therapistId: 'th-2',
    serviceCatalogId: 's1',
    visitDate: '2026-11-09',
    actualBillPaise: 80000,
    adjustmentPaise: 0,
    adjustmentReason: null,
    location: 'ward',
    treatmentIds: [],
    sessionIndex: null,
    packageTotal: null,
    packageGroupId: null,
    invoiceId: null,
    sharedPct: null,
    sharedTherapistId: null,
    deleted: false,
    updatedAt: '2026-11-09T08:00:00Z',
  },
] as unknown as Visit[];

const mockPatients: Patient[] = [
  { id: 'p-1', clinicId: 'c1', name: 'Ravi OP', phone: '9876543210', mrno: 'MRN1', age: 30, sex: 'M', deletedAt: null, updatedAt: '2026-01-01' },
  { id: 'p-2', clinicId: 'c1', name: 'Asha Home', phone: '9876543211', mrno: 'MRN2', age: 40, sex: 'F', deletedAt: null, updatedAt: '2026-01-01' },
  { id: 'p-3', clinicId: 'c1', name: 'Kavita Ward', phone: '9876543212', mrno: 'MRN3', age: 50, sex: 'F', deletedAt: null, updatedAt: '2026-01-01' },
] as unknown as Patient[];

const mockInvoices: Invoice[] = [
  {
    id: 'inv-op',
    clinicId: 'c1',
    invoiceNo: 'BM/26-27/0001',
    fyLabel: '2026-2027',
    seq: 1,
    issuedAt: '2026-11-09T10:00:00Z',
    patientSnapshot: { mrno: 'MRN1', name: 'Ravi OP', age: 30, sex: 'M' },
    lineItems: [],
    totalPaise: 50000,
    paymentMode: 'Cash',
    therapistId: 'th-1',
    supersedesInvoiceId: null,
    clinicalSnapshot: {
      diagnosis: null,
      referringPhysician: null,
      physicianRegistrationNo: null,
      placeOfService: 'clinic',
      treatmentPerformed: null,
    },
    updatedAt: '2026-11-09T10:00:00Z',
  },
  {
    id: 'inv-home',
    clinicId: 'c1',
    invoiceNo: 'BM/26-27/0002',
    fyLabel: '2026-2027',
    seq: 2,
    issuedAt: '2026-11-09T11:00:00Z',
    patientSnapshot: { mrno: 'MRN2', name: 'Asha Home', age: 40, sex: 'F' },
    lineItems: [],
    totalPaise: 60000,
    paymentMode: 'Cash',
    therapistId: 'th-1',
    supersedesInvoiceId: null,
    clinicalSnapshot: {
      diagnosis: null,
      referringPhysician: null,
      physicianRegistrationNo: null,
      placeOfService: 'home',
      treatmentPerformed: null,
    },
    updatedAt: '2026-11-09T11:00:00Z',
  },
  {
    id: 'inv-ward',
    clinicId: 'c1',
    invoiceNo: 'BM/26-27/0003',
    fyLabel: '2026-2027',
    seq: 3,
    issuedAt: '2026-11-09T12:00:00Z',
    patientSnapshot: { mrno: 'MRN3', name: 'Kavita Ward', age: 50, sex: 'F' },
    lineItems: [],
    totalPaise: 80000,
    paymentMode: 'Cash',
    therapistId: 'th-2',
    supersedesInvoiceId: null,
    clinicalSnapshot: {
      diagnosis: null,
      referringPhysician: null,
      physicianRegistrationNo: null,
      placeOfService: 'ward',
      treatmentPerformed: null,
    },
    updatedAt: '2026-11-09T12:00:00Z',
  },
];

const mockPayments: Payment[] = [
  {
    id: 'pay-op',
    clinicId: 'c1',
    visitId: 'v-op-1',
    amountPaise: 50000,
    receivedDate: '2026-11-09',
    method: 'cash',
    advanceId: null,
    notes: null,
    updatedAt: '2026-11-09T10:00:00Z',
  },
  {
    id: 'pay-home',
    clinicId: 'c1',
    visitId: 'v-home-1',
    amountPaise: 60000,
    receivedDate: '2026-11-09',
    method: 'cash',
    advanceId: null,
    notes: null,
    updatedAt: '2026-11-09T11:00:00Z',
  },
  {
    id: 'pay-ward-partner',
    clinicId: 'c1',
    visitId: 'v-ward-1',
    amountPaise: 80000,
    receivedDate: '2026-11-09',
    method: 'partner',
    advanceId: null,
    notes: null,
    updatedAt: '2026-11-09T12:00:00Z',
  },
];

const mockTherapists: Therapist[] = [
  { id: 'th-1', clinicId: 'c1', name: 'Dr. Prem', active: true, phone: null, careLocations: ['clinic', 'home'], updatedAt: '2026-01-01' },
  { id: 'th-2', clinicId: 'c1', name: 'Dr. Asha', active: true, phone: null, careLocations: ['ward'], updatedAt: '2026-01-01' },
] as unknown as Therapist[];

const mockAttributions: AttributionEntry[] = [
  {
    mechanism: 'line_share',
    visitId: 'v-op-1',
    visitDate: '2026-11-09',
    patientId: 'p-1',
    fromTherapistId: 'th-1',
    toTherapistId: 'th-2',
    grossPaise: 20000,
    postTaxPaise: 20000,
    packageGroupId: null,
    sharedPct: null,
    visitBillPaise: 50000,
    packageTotalPaise: null,
    packageSessionCount: null,
    sessionIndex: null,
    billingVisitDate: null,
    repaired: false,
    location: 'clinic',
  },
  {
    mechanism: 'line_share',
    visitId: 'v-home-1',
    visitDate: '2026-11-09',
    patientId: 'p-2',
    fromTherapistId: 'th-1',
    toTherapistId: 'th-2',
    grossPaise: 30000,
    postTaxPaise: 30000,
    packageGroupId: null,
    sharedPct: null,
    visitBillPaise: 60000,
    packageTotalPaise: null,
    packageSessionCount: null,
    sessionIndex: null,
    billingVisitDate: null,
    repaired: false,
    location: 'home',
  },
];

vi.mock('@/services', () => ({
  repos: {
    visits: {
      list: async (f: { clinicId: string; therapistId?: string }) => {
        if (f.therapistId) return mockVisits.filter((v) => v.therapistId === f.therapistId);
        return mockVisits;
      },
    },
    invoices: {
      list: async () => mockInvoices,
    },
    invoicePayments: {
      list: async () => [
        { id: 'ip-op', invoiceId: 'inv-op', status: 'paid' as PaymentStatus, paidAt: '2026-11-09' },
        { id: 'ip-home', invoiceId: 'inv-home', status: 'outstanding' as PaymentStatus, paidAt: null },
        { id: 'ip-ward', invoiceId: 'inv-ward', status: 'paid' as PaymentStatus, paidAt: '2026-11-09' },
      ],
    },
    payments: {
      list: async () => mockPayments,
    },
    patients: {
      list: async () => mockPatients,
      search: async () => [],
    },
    therapists: {
      list: async () => mockTherapists,
    },
    catalog: {
      list: async () => [{ id: 's1', name: 'Consultation', active: true }],
    },
    treatmentCatalog: {
      list: async () => [],
    },
    consultationNotes: {
      listByVisitIds: async () => [],
    },
    visitItems: {
      listByVisitIds: async () => [],
    },
    visitCredits: {
      listByVisitIds: async () => [],
    },
  },
  paymentService: {
    invoiceBalance: (input: { totalPaise: number; recordedPaise: number; status: string }) => ({
      paidPaise: input.status === 'paid' ? input.totalPaise : input.recordedPaise,
      remainingPaise: input.status === 'paid' ? 0 : Math.max(0, input.totalPaise - input.recordedPaise),
    }),
  },
  dashboardService: {
    needsReceipt: async (_clinicId: string, dept?: Department) => {
      return dept === 'home'
        ? [{ visitId: 'v-home-1', patientName: 'Asha Home', mrno: 'MRN2', visitDate: '2026-11-09', collectedPaise: 60000, therapistName: 'Dr. Prem', serviceName: 'Consultation' }]
        : [];
    },
  },
  feedbackService: {
    askForFeedback: () => Promise.resolve(),
    resend: () => Promise.resolve(),
  },
  attributionAuditService: {
    monthly: async () => mockAttributions,
  },
}));

vi.mock('@/lib/db', () => ({
  db: {
    meta: { get: () => null, put: () => Promise.resolve() },
    outbox: { filter: () => ({ count: () => 0, toArray: () => [] }) },
    payments: {
      where: () => ({
        equals: () => ({
          filter: () => ({
            toArray: async () => mockPayments,
          }),
        }),
      }),
    },
    patient_advances: {
      where: () => ({
        equals: () => ({
          filter: () => ({
            toArray: async () => [],
          }),
        }),
      }),
    },
    visits: {
      where: () => ({
        anyOf: () => ({
          toArray: async () => mockVisits,
        }),
      }),
    },
    patients: {
      where: () => ({
        anyOf: () => ({
          toArray: async () => mockPatients,
        }),
      }),
    },
  },
}));

vi.mock('dexie-react-hooks', async () => {
  const React = await import('react');
  return {
    useLiveQuery: <T,>(query: () => Promise<T> | T, deps: unknown[] = [], initial?: T) => {
      const [value, setValue] = React.useState<T | undefined>(() => {
        try {
          const res = query();
          if (res instanceof Promise) return initial;
          return res;
        } catch {
          return initial;
        }
      });
      React.useEffect(() => {
        let live = true;
        void Promise.resolve(query()).then((v) => {
          if (live) setValue(v);
        });
        return () => {
          live = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
      return value !== undefined ? value : initial;
    },
  };
});

import { InvoicesPage } from '@/features/invoices/InvoicesPage';
import { DaybookPage } from './DaybookPage';
import { CreditsTab } from './CreditsTab';

describe('Ledger department scoping (G4)', () => {
  afterEach(cleanup);

  it('InvoicesPage scopes invoices and totals to active department', async () => {
    currentDept = 'clinic';
    const { unmount } = render(<InvoicesPage />);
    const opInv = await screen.findAllByText('BM/26-27/0001');
    expect(opInv.length).toBeGreaterThan(0);
    expect(screen.queryByText('BM/26-27/0002')).toBeNull();
    expect(screen.queryByText('BM/26-27/0003')).toBeNull();
    unmount();

    currentDept = 'home';
    const { unmount: unmountHome } = render(<InvoicesPage />);
    const homeInv = await screen.findAllByText('BM/26-27/0002');
    expect(homeInv.length).toBeGreaterThan(0);
    expect(screen.queryByText('BM/26-27/0001')).toBeNull();
    expect(screen.queryByText('BM/26-27/0003')).toBeNull();
    unmountHome();

    currentDept = 'ward';
    render(<InvoicesPage />);
    const wardInv = await screen.findAllByText('BM/26-27/0003');
    expect(wardInv.length).toBeGreaterThan(0);
    expect(screen.queryByText('BM/26-27/0001')).toBeNull();
    expect(screen.queryByText('BM/26-27/0002')).toBeNull();
  });

  it('DaybookPage scopes collections per department, hides place split, and shows partner money as clearance', async () => {
    // 1. OP: Cash drawer only (₹500), no partner money, no "Of this, by place"
    currentDept = 'clinic';
    const { unmount } = render(<DaybookPage />);
    expect(await screen.findByText('Total Collected')).toBeInTheDocument();
    expect(screen.getAllByText('₹500').length).toBeGreaterThan(0);
    expect(screen.queryByText('Of this, by place')).toBeNull();
    expect(screen.queryByText('Hospital partner clearance')).toBeNull();
    unmount();

    // 2. Home care: Field collections grouped by therapist under "To hand over"
    currentDept = 'home';
    const { unmount: unmountHome } = render(<DaybookPage />);
    expect(await screen.findByText('To hand over')).toBeInTheDocument();
    expect(screen.getByText('Total to hand over')).toBeInTheDocument();
    expect(screen.getAllByText('₹600').length).toBeGreaterThan(0);
    expect(screen.queryByText('Of this, by place')).toBeNull();
    unmountHome();

    // 3. IP: Hospital partner clearance shown on its own line, not in drawer total
    currentDept = 'ward';
    render(<DaybookPage />);
    expect(await screen.findByText(/Hospital partner clearance/)).toBeInTheDocument();
    expect(screen.getByText('Not in your drawer — settled with them later')).toBeInTheDocument();
    expect(screen.getAllByText('₹800').length).toBeGreaterThan(0);
    // Drawer total is ₹0 because partner money is clearance, never cash in drawer
    expect(screen.getAllByText('₹0').length).toBeGreaterThan(0);
    expect(screen.queryByText('Of this, by place')).toBeNull();
  });

  it('CreditsTab scopes entries to active department', async () => {
    currentDept = 'clinic';
    const { unmount } = render(<CreditsTab myTherapistId="th-1" isAdmin={false} />);
    expect(await screen.findByText('Net this month')).toBeInTheDocument();
    // In OP, Dr Prem gave a 200 share on OP visit
    expect(screen.getAllByText('−₹200').length).toBeGreaterThan(0);
    unmount();

    currentDept = 'home';
    render(<CreditsTab myTherapistId="th-1" isAdmin={false} />);
    expect(await screen.findByText('Net this month')).toBeInTheDocument();
    // In Home, Dr Prem gave a 300 share on Home visit
    expect(screen.getAllByText('−₹300').length).toBeGreaterThan(0);
  });
});
