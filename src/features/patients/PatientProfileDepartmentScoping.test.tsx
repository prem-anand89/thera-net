// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Department } from '@/domain/departments';
import type { Admission, Invoice, Patient, Visit } from '@/domain/types';

let currentDept: Department = 'clinic';
let deptSetter = vi.fn((d: Department) => {
  currentDept = d;
});

vi.mock('@/app/DepartmentContext', () => ({
  useDepartment: () => ({
    department: currentDept,
    departments: ['clinic', 'home', 'ward'] as Department[],
    canSwitch: true,
    setDepartment: deptSetter,
  }),
}));

const mockClinic = {
  id: 'c1',
  name: 'Ortho Physio',
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
    canViewClinicalNotes: true,
    entitlementsLoading: false,
    invoicingOnPlan: true,
    invoiceRoleOk: true,
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

vi.mock('@/app/useEntitlements', () => ({
  useEntitlements: () => ({
    can: () => true,
  }),
}));

let mockSearch: { from?: string; view?: 'invoices' } = {};
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children, to, search, params }: { children: React.ReactNode; to?: string; search?: unknown; params?: Record<string, string> }) => (
      <a href={to ?? '#'} data-search={JSON.stringify(search)} data-params={JSON.stringify(params)}>
        {children}
      </a>
    ),
    useNavigate: () => vi.fn(),
    useParams: () => ({ patientId: 'p1' }),
    useSearch: () => mockSearch,
  };
});

const testPatient: Patient = {
  id: 'p1',
  clinicId: 'c1',
  mrno: '001',
  mrnoSource: 'auto',
  name: 'Kavita Sharma',
  phone: '9876543210',
  age: 45,
  sex: 'F',
  referringSource: null,
  referringSourceDetail: null,
  referringSourceId: null,
  email: null,
  address: null,
  notes: null,
  deleted: false,
  updatedAt: '2026-11-09T08:00:00Z',
} as unknown as Patient;

const opVisit = {
  id: 'v-op',
  clinicId: 'c1',
  patientId: 'p1',
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
} as unknown as Visit;

const homeVisit = {
  id: 'v-home',
  clinicId: 'c1',
  patientId: 'p1',
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
} as unknown as Visit;

const wardVisit = {
  id: 'v-ward',
  clinicId: 'c1',
  patientId: 'p1',
  therapistId: 'th-1',
  serviceCatalogId: 's1',
  visitDate: '2026-11-09',
  actualBillPaise: 70000,
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
} as unknown as Visit;

const opInvoice = {
  id: 'inv-op',
  clinicId: 'c1',
  invoiceNo: 'BM/26-27/0001',
  invoiceType: 'tax_invoice',
  billTo: 'patient',
  patientId: 'p1',
  patientSnapshot: { patientId: 'p1', name: 'Kavita Sharma', mrno: '001', phone: '9876543210' },
  subtotalPaise: 50000,
  taxPaise: 0,
  discountPaise: 0,
  totalPaise: 50000,
  issuedAt: '2026-11-09T09:00:00Z',
  issuedByMemberId: 'm1',
  supersedesInvoiceId: null,
  clinicalSnapshot: {
    placeOfService: 'clinic',
  },
  deleted: false,
  updatedAt: '2026-11-09T09:00:00Z',
} as unknown as Invoice;

const wardInvoice = {
  id: 'inv-ward',
  clinicId: 'c1',
  invoiceNo: 'BM/26-27/0002',
  invoiceType: 'tax_invoice',
  billTo: 'patient',
  patientId: 'p1',
  patientSnapshot: { patientId: 'p1', name: 'Kavita Sharma', mrno: '001', phone: '9876543210' },
  subtotalPaise: 70000,
  taxPaise: 0,
  discountPaise: 0,
  totalPaise: 70000,
  issuedAt: '2026-11-09T09:00:00Z',
  issuedByMemberId: 'm1',
  supersedesInvoiceId: null,
  clinicalSnapshot: {
    placeOfService: 'ward',
  },
  deleted: false,
  updatedAt: '2026-11-09T09:00:00Z',
} as unknown as Invoice;

const mockAdvances = [
  {
    id: 'adv-1',
    clinicId: 'c1',
    patientId: 'p1',
    amountPaise: 100000,
    remainingPaise: 100000,
    advanceDate: '2026-11-08',
    paymentMethod: 'cash',
    receiptNumber: 'RCP-1',
    notes: null,
    deleted: false,
  },
];

let liveVisits: Visit[] = [];
let liveInvoices: Invoice[] = [];
let liveAdvances: typeof mockAdvances = [];

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn: () => unknown) => fn(),
}));

vi.mock('@/services', () => ({
  repos: {
    patients: { get: () => testPatient },
    visits: {
      list: () => liveVisits,
      listByPatient: () => liveVisits,
      get: (id: string) => liveVisits.find((v) => v.id === id),
      softDelete: vi.fn(),
    },
    visitItems: {
      listByVisitIds: () => [],
    },
    visitCredits: {
      listByVisitIds: () => [],
    },
    patientModuleEnrollments: {
      getActive: () => undefined,
    },
    invoices: {
      list: () => liveInvoices,
      listByClinic: () => liveInvoices,
    },
    invoicePayments: {
      list: () => [],
      listByClinic: () => [],
    },
    appointments: {
      listByClinic: () => [],
      listUpcomingByPatient: () => [],
    },
    payments: {
      list: () => [],
      listByPatient: () => [],
    },
    catalog: {
      list: () => [{ id: 's1', name: 'Physiotherapy' }],
    },
    services: {
      list: () => [{ id: 's1', name: 'Physiotherapy' }],
    },
    therapists: {
      list: () => [{ id: 'th-1', name: 'Dr. Anita' }],
    },
    treatments: {
      list: () => [],
    },
    treatmentCatalog: {
      list: () => [],
    },
    referringSourceCatalog: {
      list: () => [],
    },
    admissions: {
      listByPatient: () => [],
    },
  },
  dashboardService: {
    openPackages: () => [],
  },
  advanceService: {
    openAdvancesWithBalance: () => liveAdvances,
  },
  consultationNoteService: {
    listByPatient: () => [],
    getActiveEnrollment: () => undefined,
  },
}));

vi.mock('./AdmissionSheet', () => ({
  AdmissionSheet: ({ open, onSaved }: { open: boolean; onSaved?: (a: Admission) => void }) => {
    if (!open) return null;
    return (
      <div data-testid="admission-sheet">
        <button
          type="button"
          onClick={() =>
            onSaved?.({
              id: 'adm-1',
              clinicId: 'c1',
              patientId: 'p1',
              admittedOn: '2026-11-09',
              dischargedOn: null,
              wardBed: 'Bed 4',
              ipdNo: 'IP-101',
              admittingDoctor: null,
              notes: null,
              deleted: false,
              updatedAt: '2026-11-09T08:00:00Z',
            })
          }
        >
          Confirm admission
        </button>
      </div>
    );
  },
}));

import { PatientProfilePage } from './PatientProfilePage';
import { PatientAdmissionBar } from './PatientAdmissionBar';

describe('PatientProfilePage department scoping (G7)', () => {
  beforeEach(() => {
    currentDept = 'clinic';
    deptSetter = vi.fn((d: Department) => {
      currentDept = d;
    });
    mockSearch = {};
    liveVisits = [opVisit, homeVisit, wardVisit];
    liveInvoices = [opInvoice, wardInvoice];
    liveAdvances = mockAdvances;
  });

  afterEach(cleanup);

  it('visit history displays visits from every department, each tagged with its DEPARTMENT_LABELS tag', () => {
    render(<PatientProfilePage />);

    // All three visits should be rendered in the history
    expect(screen.getByText('Kavita Sharma')).toBeInTheDocument();
    expect(screen.getAllByText('OP').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Home care').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('IP').length).toBeGreaterThanOrEqual(1);
  });

  it('bulk bill and quick-selection are scoped to the active department only', () => {
    const { unmount } = render(<PatientProfilePage />);

    // In OP, click "All unbilled"
    fireEvent.click(screen.getByRole('button', { name: 'All unbilled' }));

    // Selected visit count should be 1 (only the OP visit), total ₹500
    expect(screen.getByText('1 selected · ₹500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue invoice / collect' })).toBeInTheDocument();

    unmount();

    // Now switch to Home care
    currentDept = 'home';
    render(<PatientProfilePage />);

    fireEvent.click(screen.getByRole('button', { name: 'All unbilled' }));

    // In Home care, "All unbilled" should select only the Home care visit (₹600)
    expect(screen.getByText('1 selected · ₹600')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue invoice / collect' })).toBeInTheDocument();
  });

  it('payments summary (billed, collected, balance) reflects only the active department', () => {
    const { unmount } = render(<PatientProfilePage />);

    // In OP, only opVisit (₹500) is counted
    expect(screen.getAllByText('₹500').length).toBeGreaterThanOrEqual(1);
    // Home care (₹600) and Ward (₹700) are NOT part of the OP summary
    expect(screen.queryByText('₹1,800')).toBeNull();

    unmount();

    // Switch to Home care: only homeVisit (₹600) is counted
    currentDept = 'home';
    render(<PatientProfilePage />);
    expect(screen.getAllByText('₹600').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('₹1,800')).toBeNull();
  });

  it('advance balance is visible in OP but hidden in Home care / IP', () => {
    const { unmount } = render(<PatientProfilePage />);

    // In OP, advance is displayed
    expect(screen.getByText('₹1,000 advance available')).toBeInTheDocument();

    unmount();

    // In Home care, advancesForDepartment returns 0, so badge is hidden
    currentDept = 'home';
    render(<PatientProfilePage />);
    expect(screen.queryByText('₹1,000 advance available')).toBeNull();
  });

  it('invoices tab lists only the active department invoices', () => {
    mockSearch = { view: 'invoices' };
    const { unmount } = render(<PatientProfilePage />);

    // In OP, tab count should be 1 and list BM/26-27/0001 (clinic)
    expect(screen.getAllByText('BM/26-27/0001').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('BM/26-27/0002')).toBeNull();

    unmount();

    // In IP, tab count should be 1 and list BM/26-27/0002 (ward)
    currentDept = 'ward';
    render(<PatientProfilePage />);
    expect(screen.getAllByText('BM/26-27/0002').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('BM/26-27/0001')).toBeNull();
  });

  it('PatientAdmissionBar: "Admit to ward" shows in OP and calls setDepartment("ward") upon saving', () => {
    currentDept = 'clinic';
    render(<PatientAdmissionBar patient={testPatient} />);

    // "Admit to ward" button is visible even while in OP
    const admitBtn = screen.getByRole('button', { name: 'Admit to ward' });
    expect(admitBtn).toBeInTheDocument();

    // Clicking it opens the admission sheet
    fireEvent.click(admitBtn);
    expect(screen.getByTestId('admission-sheet')).toBeInTheDocument();

    // Confirming admission calls setDepartment('ward')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm admission' }));
    expect(deptSetter).toHaveBeenCalledWith('ward');
  });
});
