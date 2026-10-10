// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BreakPlacementControl } from './BreakPlacementControl';
import type { ShiftTemplate, TherapistShiftAssignment } from '@/domain/types';

let assignments: TherapistShiftAssignment[];
let templates: ShiftTemplate[];
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
const setBreakPlacement = vi.fn();
vi.mock('@/lib/errors', () => ({ toFriendlyMessage: (e: Error) => e.message }));
vi.mock('@/services', () => ({
  // useLiveQuery is mocked to call the querier synchronously (see
  // dexie-react-hooks mock above), so these must return plain values rather
  // than promises, matching ShiftRequestSheet.test.tsx's convention.
  repos: { therapistShiftAssignments: { listByTherapist: () => assignments }, shiftTemplates: { list: () => templates } },
  bookingService: { setBreakPlacement: (...a: unknown[]) => setBreakPlacement(...a) },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BreakPlacementControl', () => {
  it('renders nothing when no approved shift has a break', () => {
    assignments = [
      {
        id: 'a1',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: 't1',
        customHours: null,
        weekdays: [1],
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
    templates = [
      { id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' },
    ];
    const { container } = render(<BreakPlacementControl therapistId="th1" clinicId="c1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('moves the break and calls setBreakPlacement on blur', () => {
    assignments = [
      {
        id: 'a1',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: 't1',
        customHours: null,
        weekdays: [1],
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
    templates = [
      { id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 30, defaultBreakStartMinute: 660, active: true, updatedAt: '' },
    ];
    render(<BreakPlacementControl therapistId="th1" clinicId="c1" />);
    const input = screen.getByDisplayValue('11:00');
    fireEvent.change(input, { target: { value: '11:30' } });
    fireEvent.blur(input);
    expect(setBreakPlacement).toHaveBeenCalledWith('a1', 690);
  });

  const breakAssignment = (): TherapistShiftAssignment => ({
    id: 'a1', clinicId: 'c1', therapistId: 'th1', shiftTemplateId: 't1', customHours: null, weekdays: [1],
    breakStartMinute: null, status: 'approved', note: null, requestedBy: null, decidedBy: null, decidedAt: null,
    createdAt: '', updatedAt: '',
  });
  const breakTemplate: ShiftTemplate = { id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 30, defaultBreakStartMinute: 660, active: true, updatedAt: '' };

  it('does not call the RPC for a cleared time and shows an error', () => {
    assignments = [breakAssignment()];
    templates = [breakTemplate];
    render(<BreakPlacementControl therapistId="th1" clinicId="c1" />);
    const input = screen.getByDisplayValue('11:00');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(setBreakPlacement).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a break start time.')).toBeInTheDocument();
  });

  it('shows the error when the RPC rejects', async () => {
    assignments = [breakAssignment()];
    templates = [breakTemplate];
    setBreakPlacement.mockRejectedValueOnce(new Error('Break placement must fit within the shift.'));
    render(<BreakPlacementControl therapistId="th1" clinicId="c1" />);
    const input = screen.getByDisplayValue('11:00');
    fireEvent.change(input, { target: { value: '12:50' } });
    fireEvent.blur(input);
    expect(await screen.findByText('Break placement must fit within the shift.')).toBeInTheDocument();
  });
});
