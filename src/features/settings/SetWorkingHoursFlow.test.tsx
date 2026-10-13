// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SetWorkingHoursFlow } from './SetWorkingHoursFlow';
import { localDateTime } from '@/domain/schedule';
import type { Appointment, Clinic, Therapist } from '@/domain/types';

let appointments: Appointment[];
let clinic: Clinic;

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => clinic }));

const assignCustomHours = vi.fn().mockResolvedValue(undefined);

vi.mock('@/services', () => ({
  repos: {
    appointments: { listByClinic: () => appointments },
  },
  bookingService: {
    assignCustomHours: (...a: unknown[]) => assignCustomHours(...a),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const therapist: Pick<Therapist, 'id' | 'name' | 'workingHours'> = {
  id: 'th-1',
  name: 'Dr Prem',
  workingHours: null,
};

describe('SetWorkingHoursFlow', () => {
  beforeEach(() => {
    clinic = {
      id: 'c1',
      name: 'Test Clinic',
      bookingStartHour: 9,
      bookingEndHour: 17,
      closedWeekdays: [0],
      slotDurationMinutes: 30,
    } as Clinic;
    appointments = [];
  });

  it('saving with no conflicts calls assignCustomHours', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <SetWorkingHoursFlow
        open={true}
        therapist={therapist}
        onClose={onClose}
        onSaved={onSaved}
      />
    );

    // Click "Save hours"
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));

    expect(assignCustomHours).toHaveBeenCalledWith('th-1', null);
  });

  it('with conflicts, confirm appears; Cancel does not save, Save anyway does', async () => {
    const futureDate = '2099-10-15'; // Far future Thursday
    const conflictAppt: Appointment = {
      id: 'a1',
      clinicId: 'c1',
      patientId: null,
      patientName: 'P',
      patientPhone: '1',
      therapistId: 'th-1',
      scheduledAt: localDateTime(futureDate, '18:00').toISOString(), // 6 PM
      status: 'confirmed',
      durationMinutes: 30,
      requestId: null,
      visitId: null,
      rescheduleCount: 0,
      previousScheduledAt: null,
      createdAt: '',
      updatedAt: '',
    } as Appointment;
    appointments = [conflictAppt];

    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <SetWorkingHoursFlow
        open={true}
        therapist={therapist}
        onClose={onClose}
        onSaved={onSaved}
      />
    );

    // Click "Save hours"
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));

    // Confirm dialog should appear
    expect(screen.getByText('Save these hours anyway?')).toBeInTheDocument();
    expect(
      screen.getByText(/1 upcoming appointment.*fall outside these new hours/i)
    ).toBeInTheDocument();
    expect(assignCustomHours).not.toHaveBeenCalled();

    // Click Cancel on confirm dialog
    const confirmDialog = screen.getByText('Save these hours anyway?').closest('[role="dialog"]')!;
    fireEvent.click(within(confirmDialog as HTMLElement).getByRole('button', { name: 'Cancel' }));
    expect(assignCustomHours).not.toHaveBeenCalled();

    // Wait for WorkingHoursSheet to clear busy state
    const saveHoursBtn = await screen.findByRole('button', { name: 'Save hours' });
    fireEvent.click(saveHoursBtn);
    expect(screen.getByText('Save these hours anyway?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    expect(assignCustomHours).toHaveBeenCalledWith('th-1', null);
  });
});
