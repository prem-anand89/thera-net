// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShiftAssignmentsSection } from './ShiftAssignmentsSection';
import type { Clinic, ShiftTemplate, Therapist, TherapistShiftAssignment } from '@/domain/types';

let therapists: Therapist[];
let templates: ShiftTemplate[];
let assignments: TherapistShiftAssignment[];
let clinic: Clinic;

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => clinic }));

const approveShiftAssignment = vi.fn();
const declineShiftAssignment = vi.fn();
const assignShift = vi.fn();
const assignCustomHours = vi.fn();

vi.mock('@/lib/errors', () => ({ toFriendlyMessage: (e: Error) => e.message }));

vi.mock('@/services', () => ({
  repos: {
    therapists: { list: () => therapists },
    shiftTemplates: { list: () => templates },
    therapistShiftAssignments: { listByClinic: () => assignments },
  },
  bookingService: {
    assignShift: (...a: unknown[]) => assignShift(...a),
    assignCustomHours: (...a: unknown[]) => assignCustomHours(...a),
    approveShiftAssignment: (...a: unknown[]) => approveShiftAssignment(...a),
    declineShiftAssignment: (...a: unknown[]) => declineShiftAssignment(...a),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShiftAssignmentsSection', () => {
  beforeEach(() => {
    clinic = {
      id: 'c1',
      name: 'Physio Clinic',
      bookingStartHour: 9,
      bookingEndHour: 18,
      closedWeekdays: [0], // Sun closed
    } as Clinic;
  });

  it('shows pending-change strip with Approve and Decline actions', () => {
    therapists = [{ id: 'th1', clinicId: 'c1', name: 'Priya', active: true, userId: null, updatedAt: '' } as Therapist];
    templates = [
      {
        id: 't1',
        clinicId: 'c1',
        name: 'Morning',
        startMinute: 540,
        endMinute: 780,
        breakDurationMinutes: 0,
        defaultBreakStartMinute: null,
        active: true,
        updatedAt: '',
      },
    ];
    assignments = [
      {
        id: 'a1',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: 't1',
        customHours: null,
        weekdays: [1, 3],
        breakStartMinute: null,
        status: 'pending',
        note: 'Swapping shifts',
        requestedBy: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '',
        updatedAt: '',
      },
    ];

    render(<ShiftAssignmentsSection />);
    const strip = screen.getByTestId('pending-requests-strip');
    expect(strip).toHaveTextContent(/Pending shift requests \(1\)/);
    expect(strip).toHaveTextContent(/Priya/);
    expect(strip).toHaveTextContent(/Note: “Swapping shifts”/);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(approveShiftAssignment).toHaveBeenCalledWith('a1');
  });

  it('shows no pending strip when there are no pending requests', () => {
    therapists = [{ id: 'th1', clinicId: 'c1', name: 'Priya', active: true, userId: null, updatedAt: '' } as Therapist];
    templates = [];
    assignments = [];

    render(<ShiftAssignmentsSection />);
    expect(screen.queryByTestId('pending-requests-strip')).not.toBeInTheDocument();
    expect(screen.getByTestId('shift-coverage-grid')).toBeInTheDocument();
  });

  it('passes the decline reason through when declining a request', () => {
    therapists = [{ id: 'th1', clinicId: 'c1', name: 'Priya', active: true, userId: null, updatedAt: '' } as Therapist];
    templates = [];
    assignments = [
      {
        id: 'a2',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: null,
        customHours: { '1': [[540, 780]] },
        weekdays: null,
        breakStartMinute: null,
        status: 'pending',
        note: null,
        requestedBy: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '',
        updatedAt: '',
      },
    ];

    render(<ShiftAssignmentsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Decline…' }));
    fireEvent.change(screen.getByLabelText('Decline reason for Priya'), {
      target: { value: 'Staff shortage on Mondays' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(declineShiftAssignment).toHaveBeenCalledWith('a2', 'Staff shortage on Mondays');
  });

  it('blocks a second Approve tap while the first is in flight', async () => {
    therapists = [{ id: 'th1', clinicId: 'c1', name: 'Priya', active: true, userId: null, updatedAt: '' } as Therapist];
    templates = [];
    assignments = [
      {
        id: 'a3',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: null,
        customHours: null,
        weekdays: null,
        breakStartMinute: null,
        status: 'pending',
        note: null,
        requestedBy: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '',
        updatedAt: '',
      },
    ];
    let reject!: (e: Error) => void;
    approveShiftAssignment.mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r;
        })
    );

    render(<ShiftAssignmentsSection />);
    const approve = screen.getByRole('button', { name: 'Approve' });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(approveShiftAssignment).toHaveBeenCalledTimes(1);
    expect(approve).toBeDisabled();

    await act(async () => {
      reject(new Error('This request has already been actioned.'));
    });
    expect(await screen.findByText(/This request has already been actioned/)).toBeInTheDocument();
  });

  it('renders weekly coverage grid with therapist rows and weekly total hours', () => {
    therapists = [
      { id: 'th1', clinicId: 'c1', name: 'Priya Sharma', active: true, updatedAt: '' } as Therapist,
    ];
    templates = [
      {
        id: 't1',
        clinicId: 'c1',
        name: 'General Shift',
        startMinute: 540,
        endMinute: 1020,
        breakDurationMinutes: 60,
        defaultBreakStartMinute: 780,
        active: true,
        updatedAt: '',
      },
    ];
    assignments = [
      {
        id: 'a1',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: 't1',
        customHours: null,
        weekdays: [1, 2, 3, 4, 5], // Mon to Fri
        breakStartMinute: null,
        status: 'approved',
        note: null,
        requestedBy: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '',
        updatedAt: '',
      },
    ];

    clinic.closedWeekdays = [6, 0];
    render(<ShiftAssignmentsSection />);
    expect(screen.getByText('Weekly coverage')).toBeInTheDocument();
    expect(screen.getAllByText('Priya Sharma').length).toBeGreaterThanOrEqual(1);

    // 5 shifts * 7h = 35h
    expect(screen.getAllByText('35h').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('5 shifts').length).toBeGreaterThanOrEqual(1);
  });

  it('opens assign dialog on clicking Edit next to therapist name', () => {
    therapists = [
      { id: 'th1', clinicId: 'c1', name: 'Dr Prem', active: true, updatedAt: '' } as Therapist,
    ];
    templates = [
      {
        id: 't1',
        clinicId: 'c1',
        name: 'Morning Shift',
        startMinute: 540,
        endMinute: 840,
        breakDurationMinutes: 0,
        defaultBreakStartMinute: null,
        active: true,
        updatedAt: '',
      },
    ];
    assignments = [];

    render(<ShiftAssignmentsSection />);

    // Click Edit button for Dr Prem (first of desktop/mobile views)
    const editBtn = screen.getAllByLabelText(/Edit Dr Prem's schedule/i)[0]!;
    fireEvent.click(editBtn);

    // Dialog should be open
    expect(screen.getByRole('dialog', { name: /Assign shift/i })).toBeInTheDocument();
    expect(screen.getByText('Assign to 1 therapist')).toBeInTheDocument();
  });
});
