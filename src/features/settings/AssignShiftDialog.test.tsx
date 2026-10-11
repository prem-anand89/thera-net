// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssignShiftDialog } from './AssignShiftDialog';
import type { Clinic, ShiftTemplate, Therapist } from '@/domain/types';

const assignShift = vi.fn();
const assignCustomHours = vi.fn();

vi.mock('@/lib/errors', () => ({ toFriendlyMessage: (e: Error) => e.message }));

vi.mock('@/services', () => ({
  bookingService: {
    assignShift: (...a: unknown[]) => assignShift(...a),
    assignCustomHours: (...a: unknown[]) => assignCustomHours(...a),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AssignShiftDialog', () => {
  const clinic: Clinic = {
    id: 'c1',
    name: 'Clinic',
    bookingStartHour: 9,
    bookingEndHour: 18,
    closedWeekdays: [0], // Sunday
  } as Clinic;

  const therapists: Therapist[] = [
    { id: 'th1', clinicId: 'c1', name: 'Dr Prem', active: true, updatedAt: '' },
    { id: 'th2', clinicId: 'c1', name: 'Dr Kiran', active: true, updatedAt: '' },
  ];

  const templates: ShiftTemplate[] = [
    {
      id: 't1',
      clinicId: 'c1',
      name: 'Morning Shift',
      startMinute: 540,
      endMinute: 840,
      breakDurationMinutes: 30,
      defaultBreakStartMinute: 660,
      active: true,
      updatedAt: '',
    },
  ];

  it('renders prefilled therapist and submits shift assignment', () => {
    const onClose = vi.fn();
    render(
      <AssignShiftDialog
        isOpen={true}
        onClose={onClose}
        initialTherapistId="th1"
        initialWeekday={1} // Monday
        therapists={therapists}
        templates={templates}
        approvedAssignments={[]}
        pendingAssignments={[]}
        clinic={clinic}
      />
    );

    expect(screen.getByRole('dialog', { name: /Assign shift/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dr Prem/ })).toBeInTheDocument();

    // Click assign button
    const submitBtn = screen.getByRole('button', { name: 'Assign to 1 therapist' });
    fireEvent.click(submitBtn);

    expect(assignShift).toHaveBeenCalledWith({
      therapistId: 'th1',
      shiftTemplateId: 't1',
      weekdays: [1],
      breakStartMinute: null,
    });
  });

  it('supports selecting "Clinic Default Hours" to reset working hours', () => {
    const onClose = vi.fn();
    render(
      <AssignShiftDialog
        isOpen={true}
        onClose={onClose}
        initialTherapistId="th1"
        therapists={therapists}
        templates={templates}
        approvedAssignments={[]}
        pendingAssignments={[]}
        clinic={clinic}
      />
    );

    // Change dropdown to Clinic Default Hours
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '__clinic_default__' } });

    // Click submit
    const submitBtn = screen.getByRole('button', { name: /Reset 1 therapist to Clinic Default/i });
    fireEvent.click(submitBtn);

    expect(assignCustomHours).toHaveBeenCalledWith('th1', null);
  });

  it('supports quick weekday presets (Open days, Mon-Fri, All days)', () => {
    render(
      <AssignShiftDialog
        isOpen={true}
        onClose={vi.fn()}
        initialTherapistId="th1"
        therapists={therapists}
        templates={templates}
        approvedAssignments={[]}
        pendingAssignments={[]}
        clinic={clinic}
      />
    );

    // Mon-Fri preset
    fireEvent.click(screen.getByRole('button', { name: 'Mon–Fri' }));
    const submitBtn = screen.getByRole('button', { name: 'Assign to 1 therapist' });
    fireEvent.click(submitBtn);

    expect(assignShift).toHaveBeenCalledWith(
      expect.objectContaining({ weekdays: [1, 2, 3, 4, 5] })
    );
  });
});
