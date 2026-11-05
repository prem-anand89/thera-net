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

function renderCard(person: React.ComponentProps<typeof TeamMemberCard>['person'] = { key: 'p1', therapist, member: null }) {
  render(
    <TeamMemberCard
      person={person}
      membersLoaded
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

describe('"Treats patients" wording', () => {
  it('the member card badge says Treats patients', () => {
    renderCard();
    expect(screen.getByText('Treats patients')).toBeInTheDocument();
    expect(screen.queryByText('Bookable')).toBeNull();
  });

  it('a therapist has no Treats patients choice when edited: they always do', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('checkbox', { name: 'Treats patients' })).toBeNull();
    expect(screen.getByText('Registration no.')).toBeInTheDocument();
  });

  it('an admin can choose: the same box, with its hint', () => {
    renderCard({ key: 'p1', therapist, member: { userId: 'u1', email: 'a@b.c', role: 'admin', status: 'active', displayName: 'Dr Kiran', invitedAt: null, lastSignInAt: null, lastActiveAt: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('checkbox', { name: 'Treats patients' })).toBeChecked();
    expect(screen.getByText('Appears in the schedule and can be chosen on visits.')).toBeInTheDocument();
  });

  it('front desk has no choice either', () => {
    renderCard({ key: 'p1', therapist: null, member: { userId: 'u1', email: 'a@b.c', role: 'front_desk', status: 'active', displayName: 'Desk', invitedAt: null, lastSignInAt: null, lastActiveAt: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('checkbox', { name: 'Treats patients' })).toBeNull();
  });

  it('the Add form asks only for an admin login', () => {
    render(<AddTeamMemberForm clinicId="c1" onAdded={vi.fn()} />);
    expect(screen.queryByRole('checkbox', { name: /Treats patients/ })).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'admin' } });
    expect(screen.getByRole('checkbox', { name: /Treats patients/ })).not.toBeChecked();
    expect(screen.getByText('Appears in the schedule and can be chosen on visits.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'front_desk' } });
    expect(screen.queryByRole('checkbox', { name: /Treats patients/ })).toBeNull();
  });
});
