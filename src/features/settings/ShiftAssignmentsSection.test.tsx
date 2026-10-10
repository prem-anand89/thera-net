// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShiftAssignmentsSection } from './ShiftAssignmentsSection';
import type { ShiftTemplate, Therapist, TherapistShiftAssignment } from '@/domain/types';

let therapists: Therapist[];
let templates: ShiftTemplate[];
let assignments: TherapistShiftAssignment[];
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
const approveShiftAssignment = vi.fn();
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
    assignShift: vi.fn(),
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
});
