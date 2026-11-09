// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Department } from '@/domain/departments';
import type { Admission, Appointment, CatalogItem, Patient, Therapist } from '@/domain/types';

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
  offers_clinic_visits: true,
  offers_home_visits: true,
  offers_inpatient_care: true,
  enable_multi_service: false,
};

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => mockClinic,
  useSetClinic: () => vi.fn(),
}));

vi.mock('@/app/usePermissions', () => ({
  usePermissions: () => ({
    canBill: true,
    canCollectPayment: true,
    role: 'admin',
    isAdmin: true,
    canViewClinicalNotes: true,
  }),
}));

vi.mock('@/app/useSession', () => ({
  useSession: () => ({ session: { user: { id: 'u1' } } }),
}));

vi.mock('@/app/useEntitlements', () => ({
  useEntitlements: () => ({ withinCap: true, maxMonthlyVisits: 100 }),
}));

let searchParams: Record<string, string> = {};
const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children, className }: { children: React.ReactNode; className?: string }) => <a className={className}>{children}</a>,
    useNavigate: () => navigateMock,
    useSearch: () => searchParams,
    useBlocker: () => ({ proceed: vi.fn(), reset: vi.fn(), status: 'unblocked' }),
  };
});

const mockTherapists: Therapist[] = [
  { id: 't-op', clinicId: 'c1', name: 'Dr OP Only', active: true, careLocations: ['clinic'], updatedAt: '2026-01-01' },
  { id: 't-home', clinicId: 'c1', name: 'Dr Home Only', active: true, careLocations: ['home'], updatedAt: '2026-01-01' },
  { id: 't-ward', clinicId: 'c1', name: 'Dr Ward Only', active: true, careLocations: ['ward'], updatedAt: '2026-01-01' },
  { id: 't-all', clinicId: 'c1', name: 'Dr Everywhere', active: true, careLocations: null, updatedAt: '2026-01-01' },
];

const mockPatient: Patient = {
  id: 'p1',
  clinicId: 'c1',
  name: 'Anita Roy',
  phone: '9876543210',
  mrno: '101',
  mrnoSource: 'auto',
  age: 30,
  sex: 'female',
  primaryCondition: 'Knee pain',
  updatedAt: '2026-01-01',
} as unknown as Patient;

const mockService: CatalogItem = {
  id: 's1',
  clinicId: 'c1',
  category: 'General',
  name: 'Physiotherapy Session',
  sessionCount: 1,
  basePricePaise: 50000,
  active: true,
  updatedAt: '2026-01-01',
} as unknown as CatalogItem;

let mockCatalog: CatalogItem[] = [mockService];

const mockAdmission: Admission = {
  id: 'adm-1',
  clinicId: 'c1',
  patientId: 'p1',
  admittedOn: '2026-10-01',
  wardBed: 'Bed 101',
  dischargedOn: null,
  deleted: false,
  updatedAt: '2026-10-01',
} as unknown as Admission;

const mockHomeAppointment: Appointment = {
  id: 'appt-home',
  clinicId: 'c1',
  patientId: 'p1',
  patientName: 'Anita Roy',
  patientPhone: '9876543210',
  scheduledAt: '2026-10-01T10:00:00Z',
  durationMinutes: 45,
  location: 'home',
  status: 'confirmed',
  therapistId: 't-home',
  createdAt: '2026-10-01T08:00:00Z',
  updatedAt: '2026-10-01T08:00:00Z',
} as unknown as Appointment;

const createVisitMock = vi.fn().mockResolvedValue({ id: 'v1' });

vi.mock('@/services', () => ({
  repos: {
    therapists: { list: () => mockTherapists },
    patients: {
      search: () => [mockPatient],
      get: (id: string) => (id === 'p1' ? mockPatient : undefined),
      list: () => [mockPatient],
    },
    catalog: { list: () => mockCatalog },
    treatmentCatalog: { list: () => [] },
    visits: {
      list: () => [],
      get: () => undefined,
      listByPackageGroup: () => [],
    },
    admissions: {
      get: (id: string) => (id === 'adm-1' ? mockAdmission : undefined),
      listOpen: () => [mockAdmission],
    },
    payments: {
      list: () => [],
      listByVisit: () => [],
    },
    invoicePayments: { list: () => [] },
    invoices: { get: () => undefined },
    appointments: {
      listByClinic: () => [mockHomeAppointment],
    },
    visitItems: {
      listByVisitIds: () => [],
    },
    visitCredits: {
      listByVisitIds: () => [],
    },
  },
  visitService: {
    create: (...args: unknown[]) => createVisitMock(...args),
  },
  directPaymentService: { save: vi.fn() },
  dashboardService: {
    treatmentUsageCounts: () => [],
    serviceUsageCounts: () => [],
    recentVisits: () => [],
  },
  feedbackService: { requestFeedback: vi.fn() },
  bookingService: { markArrived: vi.fn() },
  consultationNoteService: { linkAppointmentNotesToVisit: vi.fn() },
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

import { NewVisitPage } from './NewVisitPage';

describe('NewVisitPage department scoping', () => {
  beforeEach(() => {
    currentDept = 'clinic';
    searchParams = {};
    mockCatalog = [mockService];
    createVisitMock.mockClear();
    navigateMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('in Home care, therapist list follows department and visit saves location: "home"', async () => {
    currentDept = 'home';
    render(<NewVisitPage />);

    // Clinic / Home toggle should NOT exist
    expect(screen.queryByRole('radio', { name: 'Clinic' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Home visit' })).not.toBeInTheDocument();

    // Select patient
    fireEvent.change(screen.getByPlaceholderText('Search ID, name or phone…'), { target: { value: 'Anita' } });
    const patientOption = await screen.findByText('Anita Roy');
    fireEvent.click(patientOption);

    // Open therapist picker
    const therapistPicker = await screen.findByRole('button', { name: /^Therapist:/ });
    fireEvent.click(therapistPicker);

    // Dr OP Only should not be in the options
    expect(screen.queryByRole('option', { name: 'Dr OP Only' })).not.toBeInTheDocument();
    // Dr Home Only and Dr Everywhere should be options
    expect(screen.getByRole('option', { name: 'Dr Home Only' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dr Everywhere' })).toBeInTheDocument();

    // Select Dr Home Only
    fireEvent.click(screen.getByRole('option', { name: 'Dr Home Only' }));

    // Select service
    const servicePicker = screen.getByRole('combobox', { name: 'Service' });
    fireEvent.change(servicePicker, { target: { value: 'Physio' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: /Physiotherapy Session/ }));

    // Save visit
    const saveBtn = screen.getByRole('button', { name: /Save visit/ });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(createVisitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'home',
          therapistId: 't-home',
          patientId: 'p1',
        })
      );
    });
  }, 30000);

  it('in OP, therapist list follows department and visit saves location: "clinic"', async () => {
    currentDept = 'clinic';
    render(<NewVisitPage />);

    // Select patient
    fireEvent.change(screen.getByPlaceholderText('Search ID, name or phone…'), { target: { value: 'Anita' } });
    const patientOption = await screen.findByText('Anita Roy');
    fireEvent.click(patientOption);

    // Open therapist picker
    const therapistPicker = await screen.findByRole('button', { name: /^Therapist:/ });
    fireEvent.click(therapistPicker);

    // Dr Home Only should not be in the options
    expect(screen.queryByRole('option', { name: 'Dr Home Only' })).not.toBeInTheDocument();
    // Dr OP Only and Dr Everywhere should be options
    expect(screen.getByRole('option', { name: 'Dr OP Only' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dr Everywhere' })).toBeInTheDocument();

    // Select Dr OP Only
    fireEvent.click(screen.getByRole('option', { name: 'Dr OP Only' }));

    // Select service
    const servicePicker = screen.getByRole('combobox', { name: 'Service' });
    fireEvent.change(servicePicker, { target: { value: 'Physio' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: /Physiotherapy Session/ }));

    // Save visit
    const saveBtn = screen.getByRole('button', { name: /Save visit/ });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(createVisitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'clinic',
          therapistId: 't-op',
          patientId: 'p1',
        })
      );
    });
  }, 30000);

  it('opening an appointment from Home care while active dept is OP sets location: "home" and scopes therapists', async () => {
    currentDept = 'clinic';
    searchParams = { appointmentId: 'appt-home', patientId: 'p1' };
    render(<NewVisitPage />);

    // Wait for patient to resolve
    await screen.findByText('Anita Roy');

    // Open therapist picker
    const therapistPicker = await screen.findByRole('button', { name: /^Therapist:/ });
    fireEvent.click(therapistPicker);

    // Dr OP Only should not be in the options because appointment is in Home care
    expect(screen.queryByRole('option', { name: 'Dr OP Only' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dr Home Only' })).toBeInTheDocument();

    // Select service
    const servicePicker = screen.getByRole('combobox', { name: 'Service' });
    fireEvent.change(servicePicker, { target: { value: 'Physio' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: /Physiotherapy Session/ }));

    // Save visit
    const saveBtn = screen.getByRole('button', { name: /Save visit/ });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(createVisitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'home',
          therapistId: 't-home',
          patientId: 'p1',
        })
      );
    });
  }, 30000);

  it('an inpatient admission visit shows Inpatient tag, scopes therapists to ward, and saves location: "ward"', async () => {
    currentDept = 'clinic';
    searchParams = { admissionId: 'adm-1', patientId: 'p1' };
    render(<NewVisitPage />);

    // Should display Inpatient bed tag
    await screen.findByText(/Inpatient · Bed 101/);

    // Open therapist picker
    const therapistPicker = await screen.findByRole('button', { name: /^Therapist:/ });
    fireEvent.click(therapistPicker);

    // Dr OP Only and Dr Home Only should not be in options; Dr Ward Only and Dr Everywhere should
    expect(screen.queryByRole('option', { name: 'Dr OP Only' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Dr Home Only' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dr Ward Only' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dr Everywhere' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'Dr Ward Only' }));

    // Select service
    const servicePicker = screen.getByRole('combobox', { name: 'Service' });
    fireEvent.change(servicePicker, { target: { value: 'Physio' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: /Physiotherapy Session/ }));

    // Save visit
    const saveBtn = screen.getByRole('button', { name: /Save visit/ });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(createVisitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'ward',
          admissionId: 'adm-1',
          therapistId: 't-ward',
          patientId: 'p1',
        })
      );
    });
  }, 30000);

  it('service picker only offers services available in current department', async () => {
    currentDept = 'clinic';
    const wardOnlyService = {
      ...mockService,
      id: 's-ward',
      name: 'Ward ICU Physio',
      departments: ['ward'],
    } as unknown as CatalogItem;
    const opService = {
      ...mockService,
      id: 's-op',
      name: 'OP General Physio',
      departments: ['clinic'],
    } as unknown as CatalogItem;
    const allService = {
      ...mockService,
      id: 's-all',
      name: 'All Depts Consultation',
      departments: null,
    } as unknown as CatalogItem;

    mockCatalog = [wardOnlyService, opService, allService];

    render(<NewVisitPage />);

    const servicePicker = screen.getByRole('combobox', { name: 'Service' });
    fireEvent.change(servicePicker, { target: { value: 'Physio' } });

    // OP service should be present, Ward-only service should NOT be present
    expect(screen.getByRole('option', { name: /OP General Physio/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Ward ICU Physio/ })).not.toBeInTheDocument();
  });
});

