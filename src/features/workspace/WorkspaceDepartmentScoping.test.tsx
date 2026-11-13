// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Department } from '@/domain/departments';
import type { Appointment, Patient, Visit } from '@/domain/types';
import type { TodayVisitRow } from '@/services/dashboardService';

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
  careLocations: ['clinic', 'home', 'ward'],
  slotDurationMinutes: 30,
};
vi.mock('@/app/clinicContext', () => ({
  useClinic: () => mockClinic,
  useSetClinic: () => vi.fn(),
  ClinicContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));

vi.mock('@/features/setup/SetupProgressBar', () => ({
  SetupProgressBar: () => null,
}));

vi.mock('@/features/setup/useSetupProgress', () => ({
  useSetupProgress: () => ({ signals: { visitLogged: true, hasTherapist: true, servicesPriced: true } }),
}));

vi.mock('@/features/notifications/NotificationNudge', () => ({
  NotificationNudge: () => null,
}));

vi.mock('@/components/InstallAppBanner', () => ({
  InstallAppBanner: () => null,
}));

vi.mock('@/components/BookSlotSheet', () => ({
  BookSlotSheet: () => null,
}));

vi.mock('@/components/StartVisitSheet', () => ({
  StartVisitSheet: () => null,
}));

vi.mock('@/components/schedule/AppointmentDetailsPanel', () => ({
  AppointmentDetailsPanel: () => null,
}));

vi.mock('@/app/useWorkspaceScope', () => ({
  useWorkspaceScope: () => ({
    isClinicWideView: true,
    isAdmin: true,
    isFrontDesk: false,
    myTherapistId: 'th-1',
    scopeTherapistId: undefined,
    isUnlinkedTherapist: false,
  }),
}));

vi.mock('@/app/useClinicRole', () => ({
  useClinicRole: () => ({
    displayName: 'Dr. Prem',
    role: 'admin',
  }),
}));

vi.mock('@/app/usePermissions', () => ({
  usePermissions: () => ({
    canBill: true,
    canCollectPayment: true,
    canViewClinicalNotes: true,
    canEditSettings: true,
  }),
}));

vi.mock('@/app/useSession', () => ({
  useSession: () => ({ session: null }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

vi.mock('@/components/schedule/TodayAppointments', () => ({
  TodayAppointments: ({ appointments }: { appointments: Appointment[] }) => (
    <div data-testid="today-appointments" data-count={appointments.length}>
      {appointments.map((a) => (
        <div key={a.id} data-testid={`apt-${a.id}`}>
          {a.patientName}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('./HomeVisitsCard', () => ({
  HomeVisitsCard: ({ appointments }: { appointments: Appointment[] }) => (
    <div data-testid="home-visits-card" data-count={appointments.length}>
      {appointments.map((a) => (
        <div key={a.id} data-testid={`home-apt-${a.id}`}>
          {a.patientName}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('./InpatientsCard', () => ({
  InpatientsCard: () => <div data-testid="inpatients-card">Inpatients Ward Rounds</div>,
}));

vi.mock('@/components/usePatientDirectory', () => ({
  usePatientDirectory: () => ({
    mrnoFor: () => 'MRN001',
    patients: [
      { id: 'p1', name: 'Sulochana', phone: '9999999999', address: '12 Beach Rd' } as unknown as Patient,
      { id: 'p2', name: 'Asha', phone: '8888888888', address: '44 Lake Rd' } as unknown as Patient,
    ],
  }),
}));

vi.mock('@/components/schedule/usePatientFlagContext', () => ({
  usePatientFlagContext: () => null,
}));

vi.mock('@/features/followUp/useFollowUpData', () => ({
  useFollowUpData: () => ({
    due: [],
    missed: [],
    noShows: [],
  }),
}));

vi.mock('@/features/visits/visitDetails', () => ({
  splitDisplay: () => ({ legacySplit: false }),
  useVisitDetails: () => new Map(),
}));

vi.mock('@/features/visits/assistedVisits', () => ({
  useAssistedVisits: () => [],
}));

vi.mock('@/features/schedule/scheduleSignals', () => ({
  useNewFeedbackResponseCount: () => 0,
  useGoogleReviewEligibleRequestIds: () => new Set(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    meta: { get: () => null, put: () => Promise.resolve() },
    outbox: { filter: () => ({ count: () => 0 }) },
  },
}));

const apt = (id: string, name: string, location: 'clinic' | 'home' | 'ward'): Appointment => ({
  id,
  clinicId: 'c1',
  patientId: `p-${id}`,
  patientName: name,
  patientPhone: '9876543210',
  scheduledAt: new Date().toISOString(),
  durationMinutes: 30,
  location,
  status: 'confirmed',
  source: 'booking',
  therapistId: 'th-1',
  requestId: null,
  visitId: null,
  rescheduleCount: 0,
  previousScheduledAt: null,
  createdAt: '2026-11-08T00:00:00Z',
  updatedAt: '2026-11-08T00:00:00Z',
});

const todayRow = (visitId: string, patientName: string, location: 'clinic' | 'home' | 'ward'): TodayVisitRow => ({
  visitId,
  patientId: `pat-${visitId}`,
  patientName,
  mrno: 'MRN001',
  age: 40,
  sex: 'M',
  condition: null,
  phone: '9876543210',
  therapistId: 'th-1',
  therapistName: 'Dr. Prem',
  sharedTherapistId: null,
  sharedPct: null,
  sharedTherapistName: null,
  serviceName: 'Consultation',
  treatmentNotes: null,
  treatmentIds: [],
  sessionIndex: null,
  packageTotal: null,
  packageGroupId: null,
  billPaise: 50000,
  collectedPaise: 50000,
  invoiceId: null,
  issuedAt: null,
  paymentState: 'paid',
  needsNote: false,
  consultationNoteId: null,
  location,
});

const wardVisit = (id: string, admissionId: string, actualBillPaise: number): Visit =>
  ({
    id,
    clinicId: 'c1',
    patientId: 'pat-1',
    therapistId: 'th-1',
    visitDate: new Date().toISOString().slice(0, 10),
    condition: null,
    treatmentNotes: null,
    serviceCatalogId: 's1',
    catalogPricePaise: actualBillPaise,
    actualBillPaise,
    adjustmentPaise: 0,
    adjustmentReason: null,
    sessionIndex: null,
    packageTotal: null,
    packageGroupId: null,
    clinicSplitPct: 75,
    taxPct: 0,
    tdsBasis: 'gross_bill',
    clinicSharePaise: actualBillPaise,
    postTaxPaise: actualBillPaise,
    tdsPaise: 0,
    partnerSharePaise: 0,
    deleted: false,
    invoiceId: null,
    location: 'ward',
    admissionId,
  } as unknown as Visit);

const mockAppointments = [
  apt('a-op-1', 'Sulochana Apt OP', 'clinic'),
  apt('a-home-1', 'Asha Apt Home', 'home'),
];

const mockTodayRows: TodayVisitRow[] = [
  todayRow('v-op-1', 'Sulochana Visit OP', 'clinic'),
  todayRow('v-home-1', 'Asha Visit Home', 'home'),
  todayRow('v-ward-1', 'Kavita Visit Ward', 'ward'),
];

const mockWardVisits: Visit[] = [
  wardVisit('v-ward-1', 'adm-1', 120000),
  wardVisit('v-ward-2', 'adm-1', 80000),
];

vi.mock('@/services', () => ({
  repos: {
    appointments: { listByClinic: () => mockAppointments },
    therapists: { list: () => [{ id: 'th-1', name: 'Dr. Prem', color: 'teal', active: true }, { id: 'th-2', name: 'Asha Rao', color: 'sky', active: true }] },
    visits: {
      list: () => mockWardVisits,
      get: () => Promise.resolve(null),
      listByPackageGroup: () => Promise.resolve([]),
    },
    appointmentRequests: { listByClinic: () => [] },
    patients: { get: () => Promise.resolve(null), list: () => [] },
    treatmentCatalog: { list: () => [] },
    consultationNotes: { listByClinic: () => [] },
    feedbackRequests: { listByClinic: () => [] },
    feedbackResponses: { listByClinic: () => [] },
  },
  dashboardService: {
    todayWorklist: () => ({ visits: mockTodayRows }),
    monthlyNewCounts: () => ({ newPatients: 1, newPackages: 0 }),
    openPackages: () => [],
    receivedOnDate: (_clinicId: string, _date: string, _therapistId?: string, dept?: Department) => {
      if (dept === 'clinic') return 50000;
      if (dept === 'home') return 30000;
      if (dept === 'ward') return 10000;
      return 90000;
    },
    receivedByMethodOnDate: () => ({ cashPaise: 50000, upiPaise: 0, cardPaise: 0 }),
    duesSummary: (_clinicId: string, _therapistId?: string, dept?: Department) => {
      if (dept === 'clinic') return { totalPaise: 40000, visitCount: 1, patientCount: 1 };
      if (dept === 'home') return { totalPaise: 20000, visitCount: 1, patientCount: 1 };
      return { totalPaise: 0, visitCount: 0, patientCount: 0 };
    },
  },
  reportService: {
    monthly: () => ({ rows: [], total: { visitCount: 0, netPostTaxPaise: 0 } }),
  },
  feedbackService: {
    askForFeedback: () => Promise.resolve(),
    resend: () => Promise.resolve(),
  },
  bookingService: {
    markAppointmentArrived: () => Promise.resolve(),
    restoreArrivedAppointment: () => Promise.resolve(),
    restoreCancelledAppointment: () => Promise.resolve(),
    restoreNoShowAppointment: () => Promise.resolve(),
    sendText: () => Promise.resolve(),
  },
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn: () => unknown) => fn(),
}));

import { WorkspacePage } from './WorkspacePage';

describe('WorkspacePage department scoping (G3)', () => {
  afterEach(cleanup);

  it('OP department: shows Appointments card and OP visits, hides Home and IP cards', () => {
    currentDept = 'clinic';
    render(<WorkspacePage />);

    // Appointments card is present and has only OP appointment
    const aptCard = screen.getByTestId('today-appointments');
    expect(aptCard).toBeInTheDocument();
    expect(aptCard).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('apt-a-op-1')).toBeInTheDocument();
    expect(screen.queryByTestId('home-visits-card')).toBeNull();
    expect(screen.queryByTestId('inpatients-card')).toBeNull();

    // Today's visits shows OP visit only (rendered in responsive table and cards)
    expect(screen.getAllByText('Sulochana Visit OP').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Asha Visit Home')).toHaveLength(0);
    expect(screen.queryAllByText('Kavita Visit Ward')).toHaveLength(0);

    // Stat tiles: Collected and Dues
    expect(screen.getByText('Collected')).toBeInTheDocument();
    expect(screen.getByText('Dues · 1')).toBeInTheDocument();
    expect(screen.queryByText(/Running charges/)).toBeNull();
  });

  it('shows a "Showing: <therapist>" chip while a therapist is picked, and clears it', () => {
    currentDept = 'clinic';
    render(<WorkspacePage />);
    expect(screen.queryByText(/^Showing:/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter by therapist'), { target: { value: 'th-2' } });
    const chip = screen.getByRole('button', { name: /Showing only Asha Rao/ });
    expect(chip).toHaveTextContent('Showing: Asha Rao');
    fireEvent.click(chip);
    expect(screen.queryByText(/^Showing:/)).toBeNull();
  });

  it('Home care department: shows Home visits today card and Home visits, hides Appointments and IP cards', () => {
    currentDept = 'home';
    render(<WorkspacePage />);

    // Home visits card is present and has only Home appointment
    const homeCard = screen.getByTestId('home-visits-card');
    expect(homeCard).toBeInTheDocument();
    expect(homeCard).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('home-apt-a-home-1')).toBeInTheDocument();
    expect(screen.queryByTestId('today-appointments')).toBeNull();
    expect(screen.queryByTestId('inpatients-card')).toBeNull();

    // Today's visits shows Home visit only
    expect(screen.getAllByText('Asha Visit Home').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Sulochana Visit OP')).toHaveLength(0);
    expect(screen.queryAllByText('Kavita Visit Ward')).toHaveLength(0);

    // Stat tiles: Collected and Dues
    expect(screen.getByText('Collected')).toBeInTheDocument();
    expect(screen.getByText('Dues · 1')).toBeInTheDocument();
    expect(screen.queryByText(/Running charges/)).toBeNull();
  });

  it('IP department: shows Inpatients card and Ward visits, replaces Dues with Running charges', () => {
    currentDept = 'ward';
    render(<WorkspacePage />);

    // Inpatients card is present; appointments and home visits cards are absent
    expect(screen.getByTestId('inpatients-card')).toBeInTheDocument();
    expect(screen.queryByTestId('today-appointments')).toBeNull();
    expect(screen.queryByTestId('home-visits-card')).toBeNull();

    // Today's visits shows Ward visit only
    expect(screen.getAllByText('Kavita Visit Ward').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Sulochana Visit OP')).toHaveLength(0);
    expect(screen.queryAllByText('Asha Visit Home')).toHaveLength(0);

    // Stat tiles: Collected and Running charges (Dues is NOT shown)
    expect(screen.getByText('Collected')).toBeInTheDocument();
    expect(screen.getByText(/Running charges · 1 stay/)).toBeInTheDocument();
    expect(screen.queryByText(/^Dues/)).toBeNull();
  });
});
