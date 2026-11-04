// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TeamMemberCard } from './TeamSection';
import type { Clinic, Therapist } from '@/domain/types';

vi.mock('@/lib/supabase', () => ({ getSupabase: () => null, publicTherapistPhotoUrl: () => null, publicLogoUrl: () => null }));
afterEach(cleanup);

const clinic = { id: 'c1', name: 'Clinic', bookingStartHour: 9, bookingEndHour: 17, closedWeekdays: [0], slotDurationMinutes: 30 } as Clinic;
const therapist: Therapist = { id: 'th1', clinicId: 'c1', name: 'Dr Kiran', active: true, workingHours: null, updatedAt: '' };

function renderCard(locked: boolean) {
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
      loginsLocked={locked}
      loginsHint="Clinic includes 5 logins"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
}

describe('a team member without a login, at the plan\'s login limit', () => {
  it('locks "Email for login" and says why, with the plan that has room', () => {
    renderCard(true);
    const box = screen.getByLabelText('Email for login');
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute('placeholder', 'No logins left on your plan');
    expect(screen.getByText(/Your plan's logins are all in use; Clinic includes 5 logins/)).toBeInTheDocument();
  });

  it('leaves it typeable below the limit, with no hint', () => {
    renderCard(false);
    const box = screen.getByLabelText('Email for login');
    expect(box).toBeEnabled();
    fireEvent.change(box, { target: { value: 'kiran@example.com' } });
    expect(box).toHaveValue('kiran@example.com');
    expect(screen.queryByText(/logins are all in use/)).toBeNull();
  });
});
