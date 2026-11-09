// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Department } from '@/domain/departments';
import type { Admission, Appointment, Patient, Therapist } from '@/domain/types';

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
  bookingStartHour: 9,
  bookingEndHour: 17,
  closedWeekdays: [0],
  departmentHours: {
    home: {
      startHour: 7,
      endHour: 15,
      slotMinutes: 45,
    },
    ward: {
      startHour: 8,
      endHour: 16,
      slotMinutes: 20,
    },
  },
};

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => mockClinic,
  useSetClinic: () => vi.fn(),
  ClinicContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));

const mockScope = {
  isClinicWideView: true,
  isAdmin: true,
  isFrontDesk: false,
  role: 'admin',
  myTherapistId: undefined,
  scopeTherapistId: undefined,
};

vi.mock('@/app/useWorkspaceScope', () => ({
  useWorkspaceScope: () => mockScope,
}));

vi.mock('@/app/usePermissions', () => ({
  usePermissions: () => ({
    canViewClinicalNotes: true,
    canManageAllBookings: true,
  }),
}));

const searchParams: Record<string, string> = { view: 'schedule', date: '2026-10-01' };
const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => <a className={className}>{children}</a>,
  useNavigate: () => navigateMock,
  useSearch: () => searchParams,
}));

const mockTherapists: Therapist[] = [
  { id: 't-op', name: 'Dr OP Only', active: true, clinicId: 'c1', careLocations: ['clinic'] } as unknown as Therapist,
  { id: 't-home', name: 'Dr Home Only', active: true, clinicId: 'c1', careLocations: ['home'] } as unknown as Therapist,
  { id: 't-all', name: 'Dr Everywhere', active: true, clinicId: 'c1', careLocations: ['clinic', 'home', 'ward'] } as unknown as Therapist,
];

const mockPatients: Patient[] = [
  { id: 'p1', name: 'Admitted Patient', phone: '9820000001', clinicId: 'c1', mrno: '101' } as unknown as Patient,
  { id: 'p2', name: 'Home Patient', phone: '9820000002', clinicId: 'c1', mrno: '102', address: '123 Marine Drive' } as unknown as Patient,
];

const mockAdmissions: Admission[] = [
  { id: 'adm-1', patientId: 'p1', clinicId: 'c1', wardBed: 'Ward B - Bed 12', admittedOn: '2026-09-28', dischargedOn: null, deleted: false } as unknown as Admission,
];

const mockAppointments: Appointment[] = [
  { id: 'a-op', clinicId: 'c1', patientName: 'OP Patient', patientPhone: '9820000001', therapistId: 't-op', scheduledAt: '2026-10-01T10:00:00.000Z', durationMinutes: 30, location: 'clinic', status: 'confirmed' } as unknown as Appointment,
  { id: 'a-home', clinicId: 'c1', patientName: 'Home Patient', patientPhone: '9820000002', therapistId: 't-home', scheduledAt: '2026-10-01T08:00:00.000Z', durationMinutes: 45, location: 'home', status: 'confirmed' } as unknown as Appointment,
  { id: 'a-ward', clinicId: 'c1', admissionId: 'adm-1', patientName: 'Admitted Patient', patientPhone: '9820000001', therapistId: 't-all', scheduledAt: '2026-10-01T09:00:00.000Z', durationMinutes: 20, location: 'ward', status: 'confirmed' } as unknown as Appointment,
];

const confirmBookingSlotMock = vi.fn(async () => 'new-slot-id');
const bookWardRoundsMock = vi.fn(async () => 'new-ward-id');

vi.mock('@/services', () => ({
  repos: {
    therapists: { list: () => mockTherapists },
    appointments: { listByClinic: () => mockAppointments },
    appointmentRequests: { listByClinic: () => [] },
    clinicClosedDates: { listByClinic: () => [] },
    therapistShiftAssignments: { listByClinic: () => [] },
    shiftTemplates: { list: () => [] },
    patients: { list: () => mockPatients },
    admissions: { listOpen: () => mockAdmissions },
    catalog: { list: () => [] },
    visits: { list: () => [] },
  },
  bookingService: {
    confirmBookingSlot: (...args: unknown[]) => confirmBookingSlotMock(...(args as [])),
    bookWardRounds: (...args: unknown[]) => bookWardRoundsMock(...(args as [])),
    assignCustomHours: vi.fn(),
  },
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (query: () => unknown) => query(),
}));

vi.mock('@/components/schedule/usePatientFlagContext', () => ({
  usePatientFlagContext: () => ({
    patientIdsWithVisits: new Set(),
    packages: new Map(),
    balanceDue: new Set(),
    noShows: new Map(),
    conditionByPatient: new Map(),
    requestNotes: new Map(),
  }),
}));

vi.mock('@/components/usePatientDirectory', () => ({
  usePatientDirectory: () => ({
    mrnoFor: () => '101',
    patients: mockPatients,
    lastVisitOn: new Map(),
  }),
}));

vi.mock('@/lib/notify', () => ({
  notify: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
  askConfirm: vi.fn(async () => true),
}));

import { ScheduleBookingsView } from './ScheduleBookingsView';

describe('ScheduleDepartmentScoping', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 30, 10, 0)); // Wed 30 Sep 2026 10:00 AM (tomorrow is 1 Oct)
    currentDept = 'clinic';
    confirmBookingSlotMock.mockClear();
    bookWardRoundsMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('therapist picker hides therapist who works only in OP when viewing Home care', () => {
    currentDept = 'home';
    render(<ScheduleBookingsView tabs={{ active: 'schedule', showFeedback: false, scheduleLabel: 'Schedule' }} />);

    // In Home care, Dr OP Only should not appear in the therapist column headers or filter
    expect(screen.queryByText('Dr OP Only')).not.toBeInTheDocument();
    // But Dr Home Only and Dr Everywhere should appear
    expect(screen.getAllByText('Dr Home Only').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dr Everywhere').length).toBeGreaterThan(0);
  });

  it("the grid spans department's own hours and slot length", () => {
    currentDept = 'home';
    render(<ScheduleBookingsView tabs={{ active: 'schedule', showFeedback: false, scheduleLabel: 'Schedule' }} />);

    // Home care starts at 7:00 AM (rendered as "7 AM" in the hour labels), whereas OP starts at 9 AM
    expect(screen.getByText('7 AM')).toBeInTheDocument();
  });

  it('Home care booking saves location: "home"', async () => {
    currentDept = 'home';
    render(<ScheduleBookingsView tabs={{ active: 'schedule', showFeedback: false, scheduleLabel: 'Schedule' }} />);

    // Click "+ Book"
    const bookBtn = screen.getByRole('button', { name: '+ Book' });
    fireEvent.click(bookBtn);

    // BookSlotSheet should be open for home
    const dialog = await screen.findByRole('dialog', { name: 'New booking' });

    // Fill new patient details
    fireEvent.click(within(dialog).getByRole('button', { name: 'New patient' }));
    fireEvent.change(within(dialog).getByLabelText('Patient name'), { target: { value: 'Sita' } });
    fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '9820000009' } });

    // Select therapist Dr Home Only
    fireEvent.click(within(dialog).getByRole('radio', { name: /Dr Home Only/ }));

    // Pick 7:00 AM slot (45-min slots start at 7:00 AM)
    fireEvent.click(within(dialog).getByRole('button', { name: '7:00 AM' }));

    // Confirm booking
    fireEvent.click(within(dialog).getByRole('button', { name: /^Confirm booking/ }));

    await waitFor(() => {
      expect(confirmBookingSlotMock).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'home',
          patientName: 'Sita',
          therapistId: 't-home',
        })
      );
    });
  });

  it('an IP round saves the stay with admissionId via bookWardRounds', async () => {
    currentDept = 'ward';
    render(<ScheduleBookingsView tabs={{ active: 'schedule', showFeedback: false, scheduleLabel: 'Schedule' }} />);

    // In IP, clicking "+ Book" opens the admitted patients picker dialog
    const bookBtn = screen.getByRole('button', { name: '+ Book' });
    fireEvent.click(bookBtn);

    // Picker shows admitted patients
    const wardDialog = await screen.findByRole('dialog', { name: 'Book ward rounds' });
    expect(within(wardDialog).getByText('Admitted Patient')).toBeInTheDocument();
    expect(within(wardDialog).getByText('Ward B - Bed 12')).toBeInTheDocument();

    // Select the admitted patient
    fireEvent.click(within(wardDialog).getByText('Admitted Patient'));

    // Now BookSlotSheet opens with stay prefilled
    const sheetDialog = await screen.findByRole('dialog', { name: 'New booking' });

    // Select therapist Dr Everywhere
    fireEvent.click(within(sheetDialog).getByRole('radio', { name: /Dr Everywhere/ }));

    // Pick 9:00 AM slot
    fireEvent.click(within(sheetDialog).getByRole('button', { name: '9:00 AM' }));

    // Confirm booking
    fireEvent.click(within(sheetDialog).getByRole('button', { name: /^Confirm booking/ }));

    await waitFor(() => {
      expect(bookWardRoundsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'c1',
          admissionId: 'adm-1',
          therapistId: 't-all',
        })
      );
    });
  });
});
