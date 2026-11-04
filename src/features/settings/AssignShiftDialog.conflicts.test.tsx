// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AssignShiftDialog } from './AssignShiftDialog';
import type { Appointment, Clinic, ShiftTemplate, Therapist } from '@/domain/types';

const assignShift = vi.fn();
const assignCustomHours = vi.fn();
let appointments: Appointment[] = [];

vi.mock('@/lib/errors', () => ({ toFriendlyMessage: (e: Error) => e.message }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1', bookingStartHour: 9, bookingEndHour: 18 }) }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
vi.mock('@/services', () => ({
  repos: { appointments: { listByClinic: () => appointments } },
  bookingService: {
    assignShift: (...a: unknown[]) => assignShift(...a),
    assignCustomHours: (...a: unknown[]) => assignCustomHours(...a),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  appointments = [];
});

const clinic = { id: 'c1', name: 'Clinic', bookingStartHour: 9, bookingEndHour: 18, closedWeekdays: [0] } as Clinic;
const therapists: Therapist[] = [{ id: 'th1', clinicId: 'c1', name: 'Dr Prem', active: true, updatedAt: '' }];
const templates: ShiftTemplate[] = [
  { id: 't1', clinicId: 'c1', name: 'Morning Shift', startMinute: 540, endMinute: 840, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' },
];

/** The next Monday at 4 pm: outside a 9–2 Monday morning shift. */
function nextMondayAt16(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  d.setHours(16, 0, 0, 0);
  return d.toISOString();
}

function renderDialog() {
  render(
    <AssignShiftDialog
      isOpen
      onClose={vi.fn()}
      initialTherapistId="th1"
      initialWeekday={1}
      therapists={therapists}
      templates={templates}
      approvedAssignments={[]}
      pendingAssignments={[]}
      clinic={clinic}
    />
  );
}

describe('AssignShiftDialog — appointments outside the new hours', () => {
  it('asks before saving, Cancel saves nothing, Save anyway saves', () => {
    appointments = [
      {
        id: 'ap1', clinicId: 'c1', patientId: null, patientName: 'P', patientPhone: '', therapistId: 'th1',
        scheduledAt: nextMondayAt16(), durationMinutes: 30, status: 'confirmed', requestId: null, visitId: null,
        rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '',
      } as Appointment,
    ];
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Assign to 1 therapist' }));
    expect(screen.getByText(/1 upcoming appointment falls outside these hours/)).toBeInTheDocument();
    expect(assignShift).not.toHaveBeenCalled();

    const confirm = screen.getByText(/falls outside these hours/).closest('[role="dialog"], [role="alertdialog"]') as HTMLElement;
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(assignShift).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Assign to 1 therapist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    expect(assignShift).toHaveBeenCalledTimes(1);
  });

  it('saves straight away when nothing falls outside', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Assign to 1 therapist' }));
    expect(assignShift).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/fall outside these hours/)).toBeNull();
  });
});
