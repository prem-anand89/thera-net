// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ShiftSheet } from './ShiftSheet';
import type { Appointment, Clinic, ShiftTemplate, Therapist, TherapistShiftAssignment } from '@/domain/types';

const assignShift = vi.fn();
const assignCustomHours = vi.fn();
let therapists: Therapist[];
let templates: ShiftTemplate[];
let assignments: TherapistShiftAssignment[];
let appointments: Appointment[];
const clinic = { id: 'c1', name: 'Clinic', bookingStartHour: 9, bookingEndHour: 18, closedWeekdays: [0] } as Clinic;

vi.mock('@/lib/errors', () => ({ toFriendlyMessage: (e: Error) => e.message }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => clinic }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
vi.mock('@/services', () => ({
  repos: {
    therapists: { list: () => therapists },
    shiftTemplates: { list: () => templates },
    therapistShiftAssignments: { listByClinic: () => assignments },
    appointments: { listByClinic: () => appointments },
  },
  bookingService: {
    assignShift: (...a: unknown[]) => assignShift(...a),
    assignCustomHours: (...a: unknown[]) => assignCustomHours(...a),
  },
}));

const morning: ShiftTemplate = {
  id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 840,
  breakDurationMinutes: 30, defaultBreakStartMinute: 660, active: true, updatedAt: '',
};
const evening: ShiftTemplate = {
  id: 't2', clinicId: 'c1', name: 'Evening', startMinute: 840, endMinute: 1140,
  breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '',
};

function approvedRow(weekdays: number[], templateId = 't1'): TherapistShiftAssignment {
  return {
    id: 'a1', clinicId: 'c1', therapistId: 'th1', shiftTemplateId: templateId, customHours: null, weekdays,
    breakStartMinute: null, status: 'approved', createdAt: '2026-10-01', updatedAt: '2026-10-01',
  } as TherapistShiftAssignment;
}

beforeEach(() => {
  therapists = [
    { id: 'th1', clinicId: 'c1', name: 'Dr Prem', active: true, updatedAt: '' } as Therapist,
    { id: 'th2', clinicId: 'c1', name: 'Dr Kiran', active: true, updatedAt: '' } as Therapist,
  ];
  templates = [morning, evening];
  assignments = [];
  appointments = [];
  assignShift.mockResolvedValue('new');
  assignCustomHours.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

describe('ShiftSheet — one person', () => {
  it('is a sheet with Shift type | Own hours | Clinic hours, starting on what the person is on now', () => {
    assignments = [approvedRow([1, 2, 3, 4, 5, 6])];
    render(<ShiftSheet open therapistId="th1" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Working hours · Dr Prem' })).toBeInTheDocument();
    const how = screen.getByRole('radiogroup', { name: 'How hours are set' });
    expect(within(how).getByRole('radio', { name: 'Shift type' })).toHaveAttribute('aria-checked', 'true');
    expect(within(how).getByRole('radio', { name: 'Own hours' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Morning/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Saturday' })).toHaveAttribute('aria-pressed', 'true');
    // Nothing changed yet: Save waits for a change.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('says which days change, and saves the shift on the picked days', async () => {
    assignments = [approvedRow([1, 2, 3, 4, 5, 6])];
    const onClose = vi.fn();
    render(<ShiftSheet open therapistId="th1" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Saturday' }));
    expect(screen.getByTestId('days-change')).toHaveTextContent('Removes Sat');
    save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(assignShift).toHaveBeenCalledWith({ therapistId: 'th1', shiftTemplateId: 't1', weekdays: [1, 2, 3, 4, 5], breakStartMinute: null });
  });

  it('quick chips set the days', () => {
    render(<ShiftSheet open therapistId="th1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Shift type' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Mon–Fri' }));
    expect(screen.getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Saturday' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('own hours are edited inside the same sheet (no second dialog) and saved as custom hours', async () => {
    render(<ShiftSheet open therapistId="th1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Own hours' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Saturday' }));
    save();
    await waitFor(() => expect(assignCustomHours).toHaveBeenCalled());
    const [id, hours] = assignCustomHours.mock.calls[0];
    expect(id).toBe('th1');
    expect(hours['6']).toBeUndefined();
    expect(hours['1']).toEqual([[540, 1080]]);
  });

  it('clinic hours resets the person', async () => {
    assignments = [approvedRow([1, 2])];
    render(<ShiftSheet open therapistId="th1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Clinic hours' }));
    save();
    await waitFor(() => expect(assignCustomHours).toHaveBeenCalledWith('th1', null));
  });

  it('asks before saving when upcoming appointments fall outside; Cancel saves nothing, Save anyway saves', async () => {
    const monday = new Date();
    monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
    monday.setHours(16, 0, 0, 0);
    appointments = [{
      id: 'ap', clinicId: 'c1', patientId: null, patientName: 'P', patientPhone: '', therapistId: 'th1',
      scheduledAt: monday.toISOString(), durationMinutes: 30, status: 'confirmed', requestId: null, visitId: null,
      rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '',
    } as Appointment];
    render(<ShiftSheet open therapistId="th1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Shift type' })); // Morning 9–2 on open days
    save();
    expect(screen.getByText(/1 upcoming appointment falls outside these hours/)).toBeInTheDocument();
    const confirm = screen.getByText(/falls outside these hours/).closest('[role="dialog"], [role="alertdialog"]') as HTMLElement;
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(assignShift).not.toHaveBeenCalled();
    save();
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(assignShift).toHaveBeenCalledTimes(1));
  });

  it('change lunch time checks that it fits the shift', () => {
    assignments = [approvedRow([1])];
    render(<ShiftSheet open therapistId="th1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change lunch time' }));
    fireEvent.change(screen.getByLabelText(/Lunch starts at/), { target: { value: '13:45' } });
    expect(screen.getByText(/Lunch must fit inside/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('ShiftSheet — assign to several', () => {
  it('picks people, offers no Own hours, and assigns each', async () => {
    render(<ShiftSheet open therapistId={null} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Assign a shift' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Own hours' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Dr Prem/ }));
    fireEvent.click(screen.getByRole('button', { name: /Dr Kiran/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Evening/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign to 2 people' }));
    await waitFor(() => expect(assignShift).toHaveBeenCalledTimes(2));
    expect(assignShift.mock.calls.map((c) => c[0].shiftTemplateId)).toEqual(['t2', 't2']);
  });

  it('with no shift types, only clinic hours is offered', () => {
    templates = [];
    render(<ShiftSheet open therapistId={null} onClose={vi.fn()} />);
    expect(screen.queryByRole('radiogroup', { name: 'How hours are set' })).toBeNull();
    expect(screen.getByText(/Uses the clinic's opening hours/)).toBeInTheDocument();
  });
});
