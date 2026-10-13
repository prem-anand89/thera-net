// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShiftRequestSheet } from './ShiftRequestSheet';
import type { ShiftTemplate, TherapistShiftAssignment } from '@/domain/types';

let templates: ShiftTemplate[];
let assignments: TherapistShiftAssignment[] = [];
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
let workingHoursProps: { value: unknown; onSave: (h: unknown) => Promise<void> } | null = null;
vi.mock('./WorkingHoursSheet', () => ({
  WorkingHoursSheet: (props: { value: unknown; onSave: (h: unknown) => Promise<void> }) => {
    workingHoursProps = props;
    return <div>custom-hours-sheet</div>;
  },
}));
vi.mock('./BreakPlacementControl', () => ({ BreakPlacementControl: () => null }));
const requestShiftAssignment = vi.fn();
const requestCustomHours = vi.fn();
vi.mock('@/services', () => ({
  // useLiveQuery is mocked to call the querier synchronously (see
  // dexie-react-hooks mock below), so this must return a plain value
  // rather than a promise, matching ShiftTemplatesSection.test.tsx's convention.
  repos: {
    shiftTemplates: { list: () => templates },
    therapistShiftAssignments: { listByTherapist: () => assignments },
  },
  bookingService: { requestShiftAssignment: (...a: unknown[]) => requestShiftAssignment(...a), requestCustomHours: (...a: unknown[]) => requestCustomHours(...a) },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  assignments = [];
});

const clinic = { startHour: 9, endHour: 17, closedWeekdays: [0] };

describe('ShiftRequestSheet', () => {
  it('renders current schedule block with headline, weekList with breaks, and last change', () => {
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
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ];
    assignments = [
      {
        id: 'a1',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: 't1',
        customHours: null,
        weekdays: [1, 3, 5],
        breakStartMinute: null,
        status: 'approved',
        note: null,
        decisionNote: null,
        requestedBy: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '2026-10-05T10:00:00Z',
        updatedAt: '2026-10-05T10:00:00Z',
      },
    ];
    const currentHours = {
      '1': [[540, 810], [870, 1020]] as [number, number][], // Mon: 9:00 AM – 1:30 PM, 2:30 PM – 5:00 PM
      '3': [[540, 1020]] as [number, number][],
      '5': [[540, 1020]] as [number, number][],
    };

    render(
      <ShiftRequestSheet
        open
        therapistId="th1"
        therapistName="Priya"
        clinicId="c1"
        clinic={clinic}
        currentWorkingHours={currentHours}
        onClose={() => {}}
      />
    );

    const block = screen.getByTestId('current-schedule-block');
    expect(block).toBeInTheDocument();
    expect(screen.getByText('General Shift (Mon, Wed, Fri)')).toBeInTheDocument();
    expect(screen.getByText('Changed by your clinic admin on 5 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('9:00 AM – 1:30 PM, 2:30 PM – 5:00 PM')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument(); // Sunday
  });

  it('renders pending and declined request blocks inside current schedule', () => {
    templates = [
      {
        id: 't1',
        clinicId: 'c1',
        name: 'Morning Shift',
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
        id: 'p1',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: 't1',
        customHours: null,
        weekdays: [1, 2, 3],
        breakStartMinute: null,
        status: 'pending',
        note: null,
        decisionNote: null,
        requestedBy: 'th1',
        decidedBy: null,
        decidedAt: null,
        createdAt: '2026-10-12T10:00:00Z',
        updatedAt: '2026-10-12T10:00:00Z',
      },
    ];

    render(
      <ShiftRequestSheet
        open
        therapistId="th1"
        therapistName="Priya"
        clinicId="c1"
        clinic={clinic}
        currentWorkingHours={null}
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/Request pending: Morning Shift \(Mon–Wed\)/)).toBeInTheDocument();
    expect(screen.getByText(/Sent on 12 Oct 2026/)).toBeInTheDocument();
  });

  it('renders declined request with decision note when no newer pending request exists', () => {
    templates = [
      {
        id: 't1',
        clinicId: 'c1',
        name: 'Morning Shift',
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
        id: 'd1',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: 't1',
        customHours: null,
        weekdays: [6],
        breakStartMinute: null,
        status: 'declined',
        note: null,
        decisionNote: 'Slot fully booked',
        requestedBy: 'th1',
        decidedBy: 'admin',
        decidedAt: '2026-10-11T12:00:00Z',
        createdAt: '2026-10-10T10:00:00Z',
        updatedAt: '2026-10-11T12:00:00Z',
      },
    ];

    render(
      <ShiftRequestSheet
        open
        therapistId="th1"
        therapistName="Priya"
        clinicId="c1"
        clinic={clinic}
        currentWorkingHours={null}
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/Declined: Morning Shift \(Sat\)/)).toBeInTheDocument();
    expect(screen.getByText(/Declined on 11 Oct 2026: “Slot fully booked”/)).toBeInTheDocument();
  });

  it('renders default schedule and no pending/declined blocks when therapist has no assignments', () => {
    templates = [];
    assignments = [];

    render(
      <ShiftRequestSheet
        open
        therapistId="th1"
        therapistName="Priya"
        clinicId="c1"
        clinic={clinic}
        currentWorkingHours={null}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Clinic default hours')).toBeInTheDocument();
    expect(screen.queryByText(/Request pending:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Declined:/)).not.toBeInTheDocument();
  });

  it('submits a shift request with the picked template and weekdays', async () => {
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' }];
    render(<ShiftRequestSheet open therapistId="th1" therapistName="Priya" clinicId="c1" clinic={clinic} currentWorkingHours={null} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByRole('button', { name: /submit request/i }));
    await screen.findByText(/waiting on approval/i);
    expect(requestShiftAssignment).toHaveBeenCalledWith({ therapistId: 'th1', shiftTemplateId: 't1', weekdays: [1] });
  });

  it('falls through to custom hours when no templates exist', () => {
    templates = [];
    render(<ShiftRequestSheet open therapistId="th1" therapistName="Priya" clinicId="c1" clinic={clinic} currentWorkingHours={null} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/set custom hours instead/i));
    expect(screen.getByText('custom-hours-sheet')).toBeInTheDocument();
  });

  it('pre-fills the custom-hours fallback with current hours and confirms submission', async () => {
    templates = [];
    const current = { '1': [[540, 780]] as [number, number][] };
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<ShiftRequestSheet open therapistId="th1" therapistName="Priya" clinicId="c1" clinic={clinic} currentWorkingHours={current} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/set custom hours instead/i));
    expect(workingHoursProps?.value).toBe(current);
    await workingHoursProps!.onSave(null);
    expect(requestCustomHours).toHaveBeenCalledWith('th1', null);
    expect(alert).toHaveBeenCalledWith(expect.stringMatching(/waiting on approval/i));
    alert.mockRestore();
  });

  it('labels the dialog by its heading and the shift select', () => {
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' }];
    render(<ShiftRequestSheet open therapistId="th1" therapistName="Priya" clinicId="c1" clinic={clinic} currentWorkingHours={null} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'My working hours' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Shift' })).toBeInTheDocument();
  });
});

