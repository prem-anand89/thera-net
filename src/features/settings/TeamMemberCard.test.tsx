// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeamMemberCard } from './SettingsPage';
import type { Clinic, ShiftTemplate, Therapist, TherapistShiftAssignment } from '@/domain/types';

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => null,
  publicTherapistPhotoUrl: () => null,
  publicLogoUrl: () => null,
}));

const clinic: Clinic = {
  id: 'c1',
  name: 'Test Clinic',
  bookingStartHour: 9,
  bookingEndHour: 17,
  closedWeekdays: [0], // Sunday closed
  slotDurationMinutes: 30,
} as Clinic;

const generalShift: ShiftTemplate = {
  id: 'tmpl-general',
  clinicId: 'c1',
  name: 'General Shift',
  startMinute: 540,
  endMinute: 960,
  breakDurationMinutes: 60,
  defaultBreakStartMinute: 810,
  active: true,
  updatedAt: '',
};

describe('TeamMemberCard', () => {
  it('shows shift template schedule summary for therapist on General Shift, never Custom schedule', () => {
    const kiranHours: Record<string, [number, number][]> = {
      '1': [[540, 810], [870, 960]],
      '2': [[540, 810], [870, 960]],
      '3': [[540, 810], [870, 960]],
      '4': [[540, 810], [870, 960]],
      '5': [[540, 810], [870, 960]],
      '6': [[540, 810], [870, 960]],
    };
    const therapist: Therapist = {
      id: 'th-kiran',
      clinicId: 'c1',
      name: 'Dr Kiran',
      active: true,
      workingHours: kiranHours,
      updatedAt: '',
    };
    const assignments: TherapistShiftAssignment[] = [
      {
        id: 'a1',
        clinicId: 'c1',
        therapistId: 'th-kiran',
        shiftTemplateId: 'tmpl-general',
        customHours: null,
        weekdays: [1, 2, 3, 4, 5, 6],
        breakStartMinute: 810,
        status: 'approved',
        note: null,
        decisionNote: null,
        requestedBy: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];

    render(
      <TeamMemberCard
        person={{ key: 'p1', therapist, member: null }}
        clinicId="c1"
        isLastAdmin={false}
        revoking={false}
        resending={false}
        onRevoke={vi.fn()}
        onResend={vi.fn()}
        onSaved={vi.fn()}
        onDelete={vi.fn()}
        onPhotoUpload={vi.fn()}
        onDeactivate={vi.fn()}
        assignments={assignments}
        templates={[generalShift]}
        clinic={clinic}
      />
    );

    expect(screen.getByText('Mon–Sat 9–1:30 & 2:30–4')).toBeInTheDocument();
    expect(screen.queryByText('Custom schedule')).toBeNull();
  });

  it('shows stored custom hours summary for therapist with only custom hours', () => {
    const therapist: Therapist = {
      id: 'th-custom',
      clinicId: 'c1',
      name: 'Dr Consultant',
      active: true,
      workingHours: {
        '2': [[600, 780]], // Tue 10-1
        '6': [[600, 780]], // Sat 10-1
      },
      updatedAt: '',
    };

    render(
      <TeamMemberCard
        person={{ key: 'p2', therapist, member: null }}
        clinicId="c1"
        isLastAdmin={false}
        revoking={false}
        resending={false}
        onRevoke={vi.fn()}
        onResend={vi.fn()}
        onSaved={vi.fn()}
        onDelete={vi.fn()}
        onPhotoUpload={vi.fn()}
        onDeactivate={vi.fn()}
        assignments={[]}
        templates={[]}
        clinic={clinic}
      />
    );

    expect(screen.getByText('Tue, Sat 10–1')).toBeInTheDocument();
    expect(screen.queryByText('Custom schedule')).toBeNull();
  });

  it('shows clinic default summary for therapist with no hours and no assignments', () => {
    const therapist: Therapist = {
      id: 'th-default',
      clinicId: 'c1',
      name: 'Dr Default',
      active: true,
      workingHours: null,
      updatedAt: '',
    };

    render(
      <TeamMemberCard
        person={{ key: 'p3', therapist, member: null }}
        clinicId="c1"
        isLastAdmin={false}
        revoking={false}
        resending={false}
        onRevoke={vi.fn()}
        onResend={vi.fn()}
        onSaved={vi.fn()}
        onDelete={vi.fn()}
        onPhotoUpload={vi.fn()}
        onDeactivate={vi.fn()}
        assignments={[]}
        templates={[]}
        clinic={clinic}
      />
    );

    expect(screen.getByText('Mon–Sat 9–5')).toBeInTheDocument();
    expect(screen.queryByText('Custom schedule')).toBeNull();
  });
});
