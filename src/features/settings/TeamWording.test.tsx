// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AddTeamMemberForm, TeamMemberCard } from './TeamSection';
import type { Clinic, Therapist } from '@/domain/types';

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => null,
  publicTherapistPhotoUrl: () => null,
  publicLogoUrl: () => null,
}));

afterEach(cleanup);

const clinic = { id: 'c1', name: 'Test Clinic', bookingStartHour: 9, bookingEndHour: 17, closedWeekdays: [0], slotDurationMinutes: 30 } as Clinic;
const therapist: Therapist = { id: 'th1', clinicId: 'c1', name: 'Dr Kiran', active: true, workingHours: null, updatedAt: '' };

function renderCard() {
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
      assignments={[]}
      templates={[]}
      clinic={clinic}
    />
  );
}

describe('"Sees patients" wording', () => {
  it('the member card badge says Sees patients', () => {
    renderCard();
    expect(screen.getByText('Sees patients')).toBeInTheDocument();
    expect(screen.queryByText('Bookable')).toBeNull();
  });

  it('the edit checkbox says Sees patients, with its hint, and is still on for an active therapist', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const box = screen.getByRole('checkbox', { name: 'Sees patients' });
    expect(box).toBeChecked();
    expect(screen.getByText('Appears in the schedule and can be chosen on visits.')).toBeInTheDocument();
    expect(screen.queryByText('Bookable in schedule')).toBeNull();
  });

  it('the Add form says Sees patients, with the same hint', () => {
    render(<AddTeamMemberForm clinicId="c1" onAdded={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: /Sees patients/ })).toBeChecked();
    expect(screen.getByText('Appears in the schedule and can be chosen on visits.')).toBeInTheDocument();
    expect(screen.queryByText(/Bookable/)).toBeNull();
  });
});
