// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShiftAssignmentsSection } from './ShiftAssignmentsSection';
import type { ShiftTemplate, Therapist, TherapistShiftAssignment } from '@/domain/types';

let therapists: Therapist[];
let templates: ShiftTemplate[];
let assignments: TherapistShiftAssignment[];
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
const approveShiftAssignment = vi.fn();
const assignShift = vi.fn();
vi.mock('@/lib/errors', () => ({ toFriendlyMessage: (e: Error) => e.message }));
const declineShiftAssignment = vi.fn();
vi.mock('@/services', () => ({
  // useLiveQuery is mocked to call the querier synchronously (see
  // dexie-react-hooks mock above), so these must return plain values
  // rather than promises, matching ShiftTemplatesSection.test.tsx's convention.
  repos: {
    therapists: { list: () => therapists },
    shiftTemplates: { list: () => templates },
    therapistShiftAssignments: { listByClinic: () => assignments },
  },
  bookingService: {
    assignShift: (...a: unknown[]) => assignShift(...a),
    approveShiftAssignment: (...a: unknown[]) => approveShiftAssignment(...a),
    declineShiftAssignment: (...a: unknown[]) => declineShiftAssignment(...a),
  },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ShiftAssignmentsSection', () => {
  it('shows a pending-change badge with Approve/Decline', () => {
    therapists = [{ id: 'th1', clinicId: 'c1', name: 'Priya', active: true, userId: null, updatedAt: '' } as Therapist];
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' }];
    assignments = [{ id: 'a1', clinicId: 'c1', therapistId: 'th1', shiftTemplateId: 't1', customHours: null, weekdays: [1, 3], breakStartMinute: null, status: 'pending', note: null, requestedBy: null, decidedBy: null, decidedAt: null, createdAt: '', updatedAt: '' }];
    render(<ShiftAssignmentsSection />);
    expect(screen.getByText(/Pending: Morning/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(approveShiftAssignment).toHaveBeenCalledWith('a1');
  });

  it('shows no pending badge when there is none', () => {
    therapists = [{ id: 'th1', clinicId: 'c1', name: 'Priya', active: true, userId: null, updatedAt: '' } as Therapist];
    templates = [];
    assignments = [];
    render(<ShiftAssignmentsSection />);
    expect(screen.queryByText(/Pending:/)).not.toBeInTheDocument();
    expect(screen.getByText(/No shift templates yet/)).toBeInTheDocument();
  });

  const priya = () => [{ id: 'th1', clinicId: 'c1', name: 'Priya', active: true, userId: null, updatedAt: '' } as Therapist];
  const customRow = (customHours: TherapistShiftAssignment['customHours'], note: string | null = null): TherapistShiftAssignment => ({
    id: 'a2', clinicId: 'c1', therapistId: 'th1', shiftTemplateId: null, customHours, weekdays: null, breakStartMinute: null,
    status: 'pending', note, requestedBy: null, decidedBy: null, decidedAt: null, createdAt: '', updatedAt: '',
  });

  it('shows the actual hours and the note for a pending custom-hours request', () => {
    therapists = priya();
    templates = [];
    assignments = [customRow({ '1': [[540, 780]], '3': [[840, 1080]] }, 'School run on Wednesdays')];
    render(<ShiftAssignmentsSection />);
    expect(screen.getByText('Pending: Custom hours — Mon: 09:00–13:00, Wed: 14:00–18:00')).toBeInTheDocument();
    expect(screen.getByText('Note: School run on Wednesdays')).toBeInTheDocument();
  });

  it('shows "Reset to clinic hours" for the JSON-null sentinel request', () => {
    therapists = priya();
    templates = [];
    assignments = [customRow(null)];
    render(<ShiftAssignmentsSection />);
    expect(screen.getByText('Pending: Reset to clinic hours')).toBeInTheDocument();
  });

  it('passes the decline reason through', () => {
    therapists = priya();
    templates = [];
    assignments = [customRow({ '1': [[540, 780]] })];
    render(<ShiftAssignmentsSection />);
    fireEvent.change(screen.getByLabelText('Decline reason for Priya'), { target: { value: 'Short-staffed Mondays' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(declineShiftAssignment).toHaveBeenCalledWith('a2', 'Short-staffed Mondays');
  });

  it('blocks a second Approve tap while the first is in flight, then shows its error', async () => {
    therapists = priya();
    templates = [];
    assignments = [customRow({ '1': [[540, 780]] })];
    let reject!: (e: Error) => void;
    approveShiftAssignment.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    render(<ShiftAssignmentsSection />);
    const approve = screen.getByRole('button', { name: 'Approve' });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(approveShiftAssignment).toHaveBeenCalledTimes(1);
    expect(approve).toBeDisabled();
    await act(async () => { reject(new Error('This request has already been actioned.')); });
    expect(screen.getByText('This request has already been actioned.')).toBeInTheDocument();
    expect(approve).not.toBeDisabled();
  });

  it('shows an error when assigning fails', async () => {
    therapists = priya();
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' }];
    assignments = [];
    assignShift.mockRejectedValueOnce(new Error('Shift template not found.'));
    render(<ShiftAssignmentsSection />);
    fireEvent.change(screen.getByLabelText('Shift to assign to Priya'), { target: { value: 't1' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(await screen.findByText('Shift template not found.')).toBeInTheDocument();
  });
});
