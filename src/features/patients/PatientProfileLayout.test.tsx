// @vitest-environment jsdom
// The patient profile's layout: one header card (status pills, next appointment, package), the tabs right under it,
// and a side rail with Needs attention, Stay, Payments, Care plan and Clinical notes. Every action a role had before
// the reorganisation stays reachable for that role.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Department } from '@/domain/departments';
import type { Admission, Patient, Visit } from '@/domain/types';
import type { OpenPackageRow } from '@/services/dashboardService';

const perms = {
  canBill: true,
  canCollectPayment: true,
  canViewClinicalNotes: true,
  canPrintNotes: true,
  canUseExercises: true,
  isAdmin: true,
  invoicingOnPlan: true,
  invoiceRoleOk: true,
};
let currentDept: Department = 'clinic';
let deptList: Department[] = ['clinic', 'ward'];
let dot = false;
const navigate = vi.fn();

vi.mock('@/app/DepartmentContext', () => ({
  useDepartment: () => ({ department: currentDept, departments: deptList, canSwitch: true, setDepartment: vi.fn() }),
}));
const mockClinic = { id: 'c1', name: 'Ortho Physio', careLocations: ['clinic', 'ward'], slotDurationMinutes: 30, timezone: 'Asia/Kolkata' };
vi.mock('@/app/clinicContext', () => ({ useClinic: () => mockClinic }));
vi.mock('@/app/usePermissions', () => ({ usePermissions: () => perms }));
vi.mock('@/app/useWorkspaceScope', () => ({
  useWorkspaceScope: () => ({ isAdmin: true, isFrontDesk: false, myTherapistId: 'th-1', isClinicWideView: true, scopeTherapistId: null }),
}));
vi.mock('@/app/useEntitlements', () => ({ useEntitlements: () => ({ can: () => true }) }));
vi.mock('@/features/hep/useHomeProgramDot', () => ({ useHomeProgramDot: (_id: string, enabled: boolean) => enabled && dot }));
vi.mock('@/features/hep/HomeProgramTab', () => ({ HomeProgramTab: () => <div>home program content</div> }));
vi.mock('./AdmissionSheet', () => ({ AdmissionSheet: () => null }));
vi.mock('./DischargeSheet', () => ({ DischargeSheet: () => null }));
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children, to, search, params, className }: { children: React.ReactNode; to?: string; search?: unknown; params?: Record<string, string>; className?: string }) => (
      <a href={to ?? '#'} className={className} data-search={JSON.stringify(search)} data-params={JSON.stringify(params)}>
        {children}
      </a>
    ),
    useNavigate: () => navigate,
    useParams: () => ({ patientId: 'p1' }),
    useSearch: () => ({}),
  };
});

const patient = {
  id: 'p1', clinicId: 'c1', mrno: '001', mrnoSource: 'manual', name: 'Kavita Sharma', phone: '9876543210', age: 45, sex: 'F',
  primaryCondition: 'Right ankle sprain', referringSource: null, referringSourceDetail: null, referringSourceId: null,
  email: null, address: null, notes: null, deleted: false, updatedAt: '2026-11-09T08:00:00Z',
} as unknown as Patient;

const visit = (id: string, over: Partial<Visit> = {}) =>
  ({
    id, clinicId: 'c1', patientId: 'p1', therapistId: 'th-1', serviceCatalogId: 's1', visitDate: '2026-11-09', actualBillPaise: 50000,
    location: 'clinic', treatmentIds: [], invoiceId: null, deleted: false, updatedAt: '2026-11-09T08:00:00Z', ...over,
  }) as unknown as Visit;

const stay = (over: Partial<Admission> = {}): Admission => ({
  id: 's1', clinicId: 'c1', patientId: 'p1', ipdNo: null, wardBed: 'Ortho, bed 2', admittingDoctor: null,
  admittedOn: '2026-11-01', dischargedOn: null, notes: null, deleted: false, updatedAt: '', ...over,
});

const pkg = (over: Partial<OpenPackageRow> = {}) =>
  ({
    packageGroupId: 'g1', patientId: 'p1', serviceName: 'Physio 10-pack', sessionsLogged: 4, packageTotal: 10,
    lastVisitOn: '2026-11-09', daysSinceLastVisit: 2, stale: false, nearingCompletion: false, ...over,
  }) as OpenPackageRow;

let liveVisits: Visit[] = [];
let liveStays: Admission[] = [];
let liveAppointments: unknown[] = [];
let livePackages: OpenPackageRow[] = [];
let liveNotes: unknown[] = [];

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (fn: () => unknown) => fn() }));
vi.mock('@/services', () => ({
  repos: {
    patients: { get: () => patient },
    visits: { list: () => liveVisits, get: () => undefined, softDelete: vi.fn() },
    visitItems: { listByVisitIds: () => [] },
    visitCredits: { listByVisitIds: () => [] },
    patientModuleEnrollments: { getActive: () => undefined },
    invoices: { list: () => [] },
    invoicePayments: { list: () => [] },
    appointments: { listByClinic: () => liveAppointments },
    payments: { list: () => [] },
    catalog: { list: () => [{ id: 's1', name: 'Physiotherapy' }] },
    therapists: { list: () => [{ id: 'th-1', name: 'Dr. Anita' }] },
    treatmentCatalog: { list: () => [] },
    referringSourceCatalog: { list: () => [] },
    admissions: { listByPatient: () => liveStays },
  },
  dashboardService: { openPackages: () => livePackages },
  advanceService: { openAdvancesWithBalance: () => [] },
  consultationNoteService: { listByPatient: () => liveNotes },
  admissionService: {},
}));

import { PatientProfilePage } from './PatientProfilePage';

const header = () => screen.getByRole('region', { name: 'Patient' });
const stayCard = () => screen.getByRole('region', { name: 'Ward stay' });

beforeEach(() => {
  Object.assign(perms, {
    canBill: true, canCollectPayment: true, canViewClinicalNotes: true, canPrintNotes: true, canUseExercises: true,
    isAdmin: true, invoicingOnPlan: true, invoiceRoleOk: true,
  });
  currentDept = 'clinic';
  deptList = ['clinic', 'ward'];
  dot = false;
  navigate.mockClear();
  liveVisits = [visit('v1', { clinicalStatus: 'documented' })];
  liveStays = [];
  liveAppointments = [];
  livePackages = [];
  liveNotes = [];
});
afterEach(cleanup);

describe('Patient profile header card', () => {
  it('shows the next appointment and the open package when there are some', () => {
    liveAppointments = [
      { id: 'a1', clinicId: 'c1', patientId: 'p1', therapistId: 'th-1', scheduledAt: '2099-11-18T12:00:00Z', status: 'scheduled' },
    ];
    livePackages = [pkg()];
    render(<PatientProfilePage />);
    const h = within(header());
    expect(h.getByText('Next appointment')).toBeInTheDocument();
    expect(h.getByText(/18 Nov at/)).toBeInTheDocument();
    expect(h.getByText('Package')).toBeInTheDocument();
    expect(h.getByText('6 of 10 left')).toBeInTheDocument();
  });

  it('leaves out the next appointment and package when there are none', () => {
    render(<PatientProfilePage />);
    const h = within(header());
    expect(h.queryByText('Next appointment')).toBeNull();
    expect(h.queryByText('Package')).toBeNull();
    // identity still there
    expect(h.getByText('Kavita Sharma')).toBeInTheDocument();
    expect(h.getByText('001')).toBeInTheDocument();
    expect(h.getByText('Right ankle sprain')).toBeInTheDocument();
  });

  it('keeps Call, WhatsApp, Edit, Book appointment, Record advance and New visit in the header', () => {
    render(<PatientProfilePage />);
    const h = within(header());
    expect(h.getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:9876543210');
    expect(h.getByRole('button', { name: /WhatsApp/ })).toBeInTheDocument();
    expect(h.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(h.getByRole('button', { name: 'Book appointment' })).toBeInTheDocument();
    expect(h.getByRole('button', { name: 'Record advance' })).toBeInTheDocument();
    expect(h.getByRole('link', { name: 'New visit' })).toHaveAttribute('href', '/visits/new');
  });

  it('hides Record advance from someone who cannot collect payments, as before', () => {
    perms.canCollectPayment = false;
    render(<PatientProfilePage />);
    expect(within(header()).queryByRole('button', { name: 'Record advance' })).toBeNull();
  });

  it('shows the admitted and pain pills', () => {
    liveStays = [stay()];
    dot = true;
    render(<PatientProfilePage />);
    const h = within(header());
    expect(h.getByText(/^Admitted · Ortho, bed 2 · day \d+$/)).toBeInTheDocument();
    expect(h.getByText('Pain reported')).toBeInTheDocument();
  });
});

describe('Patient profile tabs', () => {
  it('keeps the same tabs, directly under the header and before the rail', () => {
    liveStays = [stay()];
    render(<PatientProfilePage />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Visits (1)', 'Invoices (0)', 'Home program']);
    const tablist = screen.getByRole('tablist');
    expect(header().compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tablist.compareDocumentPosition(stayCard()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The old session-notes bar no longer sits between the header and the tabs.
    expect(screen.queryByRole('heading', { name: 'Session notes' })).toBeNull();
  });
});

describe('Needs attention', () => {
  it('is absent when nothing needs attention', () => {
    render(<PatientProfilePage />);
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
  });

  it('lists sessions needing a note with the Write session notes link', () => {
    liveVisits = [visit('v1', { clinicalStatus: 'pending', visitDate: '2026-11-08' }), visit('v2', { clinicalStatus: 'pending' })];
    render(<PatientProfilePage />);
    const card = within(screen.getByRole('region', { name: 'Needs attention' }));
    expect(card.getByText('2 sessions need a note')).toBeInTheDocument();
    const link = card.getByRole('link', { name: 'Write session notes' });
    expect(link).toHaveAttribute('href', '/patients/$patientId/notes/session-batch');
    expect(JSON.parse(link.getAttribute('data-search')!)).toMatchObject({ visitIds: ['v1', 'v2'] });
  });

  it('has no note action for someone who cannot see clinical notes', () => {
    perms.canViewClinicalNotes = false;
    liveVisits = [visit('v1', { clinicalStatus: 'pending' })];
    render(<PatientProfilePage />);
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Write session notes' })).toBeNull();
  });

  it('pain to review opens the Home program tab', () => {
    dot = true;
    render(<PatientProfilePage />);
    const card = within(screen.getByRole('region', { name: 'Needs attention' }));
    fireEvent.click(card.getByRole('button', { name: 'Review' }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ search: { view: 'home-program' } }));
  });
});

describe('Stay card', () => {
  it('shows Bill this stay, Edit stay and Discharge for an admitted patient to someone who can bill', () => {
    liveStays = [stay()];
    liveVisits = [visit('w1', { location: 'ward', admissionId: 's1' } as Partial<Visit>)];
    render(<PatientProfilePage />);
    const card = within(stayCard());
    expect(card.getByRole('heading', { name: 'Stay' })).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Bill this stay' })).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Edit stay' })).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Discharge' })).toBeInTheDocument();
  });

  it('has no Bill this stay without billing access, but still Edit stay and Discharge', () => {
    perms.canBill = false;
    liveStays = [stay()];
    liveVisits = [visit('w1', { location: 'ward', admissionId: 's1' } as Partial<Visit>)];
    render(<PatientProfilePage />);
    const card = within(stayCard());
    expect(card.queryByRole('button', { name: 'Bill this stay' })).toBeNull();
    expect(card.getByRole('button', { name: 'Edit stay' })).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Discharge' })).toBeInTheDocument();
  });

  it('offers Admit to ward only to someone with the ward department', () => {
    const { unmount } = render(<PatientProfilePage />);
    expect(within(stayCard()).getByRole('button', { name: 'Admit to ward' })).toBeInTheDocument();
    unmount();
    deptList = ['clinic'];
    render(<PatientProfilePage />);
    expect(within(stayCard()).queryByRole('button', { name: 'Admit to ward' })).toBeNull();
  });
});

describe('Rail keeps the session-log links', () => {
  const sessionNote = { id: 'n1', patientId: 'p1', noteMode: 'session', status: 'completed', enrollmentId: 'e1', updatedAt: '2026-11-09T10:00:00Z' };

  it('shows View session log and Insurer packet in the Clinical notes card for someone who can print notes', () => {
    liveNotes = [sessionNote];
    render(<PatientProfilePage />);
    expect(screen.getByRole('heading', { name: 'Payments' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Care plan' })).toBeInTheDocument();
    const notesCard = within(screen.getByRole('region', { name: 'Clinical notes' }));
    expect(notesCard.getByRole('link', { name: 'View session log' })).toHaveAttribute('href', '/patients/$patientId/session-log/$enrollmentId');
    expect(notesCard.getByRole('link', { name: 'Insurer packet' })).toHaveAttribute('href', '/patients/$patientId/insurer-packet/$enrollmentId');
  });

  it('hides them from someone who cannot print notes, as before', () => {
    perms.canPrintNotes = false;
    liveNotes = [sessionNote];
    render(<PatientProfilePage />);
    expect(screen.queryByRole('link', { name: 'View session log' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Insurer packet' })).toBeNull();
  });
});
