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

    // With bookingStartHour: 9 and bookingEndHour: 17, label should be "Default (9–5)", not hardcoded "Default (9–6)"
    const defaultLabels = screen.getAllByText('Default (9–5)');
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
});
