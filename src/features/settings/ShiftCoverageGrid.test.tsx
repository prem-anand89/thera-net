// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShiftCoverageGrid } from './ShiftCoverageGrid';
import type { Clinic, Therapist } from '@/domain/types';

vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));

const baseClinic: Clinic = {
  id: 'c1',
  name: 'Test Clinic',
  bookingSlug: 'test-clinic',
  enablePatientComms: true,
  bookingStartHour: 9,
  bookingEndHour: 17, // 9:00 AM to 5:00 PM (8-hour day)
  closedWeekdays: [0], // Closed Sundays
  slotDurationMinutes: 30,
  logoPath: null,
  googleReviewUrl: null,
} as Clinic;

const therapist: Therapist = {
  id: 't1',
  clinicId: 'c1',
  name: 'Dr Anita Desai',
  active: true,
  publicBookable: true,
  updatedAt: '',
};

describe('ShiftCoverageGrid', () => {
  it('renders dynamic clinic default hours label based on clinic settings', () => {
    render(
      <ShiftCoverageGrid
        therapists={[therapist]}
        templates={[]}
        approvedAssignments={[]}
        pendingAssignments={[]}
        clinic={baseClinic}
      />
    );

    // With bookingStartHour: 9 and bookingEndHour: 17, label should be "9–5", not hardcoded "Default (9–6)"
    const defaultLabels = screen.getAllByText('9–5');
    expect(defaultLabels.length).toBeGreaterThan(0);
  });

  it('renders sticky classes on therapist column and weekly total column', () => {
    const { container } = render(
      <ShiftCoverageGrid
        therapists={[therapist]}
        templates={[]}
        approvedAssignments={[]}
        pendingAssignments={[]}
        clinic={baseClinic}
      />
    );

    // Left sticky column header and body
    const stickyLeft = container.querySelector('.sticky.left-0');
    expect(stickyLeft).toBeInTheDocument();

    // Right sticky weekly total column header and body
    const stickyRight = container.querySelector('.sticky.right-0');
    expect(stickyRight).toBeInTheDocument();
  });

  it('renders Edit button next to therapist name and day cells are read-only divs', () => {
    const { container } = render(
      <ShiftCoverageGrid
        therapists={[therapist]}
        templates={[]}
        approvedAssignments={[]}
        pendingAssignments={[]}
        clinic={baseClinic}
      />
    );

    // Edit button is present next to therapist name
    const editBtn = screen.getAllByRole('button', { name: `Edit ${therapist.name}'s schedule` })[0];
    expect(editBtn).toBeInTheDocument();

    // Verify day cells in the table do not contain buttons
    const dayCells = container.querySelectorAll('tbody td');
    // Cell 0 is the therapist name column (which has the Edit button)
    // Cells 1 to 7 are the weekday cells
    for (let i = 1; i <= 7; i++) {
      expect(dayCells[i].querySelector('button')).toBeNull();
    }
  });

  it('renders compact range for custom hours and split shifts instead of hardcoded Custom', () => {
    const customTherapist: Therapist = {
      id: 't-custom',
      clinicId: 'c1',
      name: 'Dr Consultant',
      active: true,
      publicBookable: true,
      workingHours: {
        '1': [[540, 780], [840, 1020]], // Mon: 9-1 & 2-5 -> span 9-5
        '2': [[600, 780]],              // Tue: 10-1
      },
      updatedAt: '',
    };

    render(
      <ShiftCoverageGrid
        therapists={[customTherapist]}
        templates={[]}
        approvedAssignments={[]}
        pendingAssignments={[]}
        clinic={baseClinic}
      />
    );

    // Mon shows 9–5, Tue shows 10–1
    expect(screen.getAllByText('9–5').length).toBeGreaterThan(0);
    expect(screen.getByText('10–1')).toBeInTheDocument();
    expect(screen.queryByText('Custom')).toBeNull();
  });
});

