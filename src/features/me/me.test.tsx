// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Therapist } from '@/domain/types';

const put = vi.fn().mockResolvedValue(undefined);
const signOut = vi.fn().mockResolvedValue({ error: null });
vi.mock('@/services', () => ({
  repos: { therapists: { put: (t: unknown) => put(t) } },
  bookingService: { setWorkingHours: vi.fn() },
}));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { signOut } }),
  publicTherapistPhotoUrl: () => null,
}));
vi.mock('@/app/useSession', () => ({
  useSession: () => ({ session: { user: { id: 'u1', email: 'ritu@clinic.test' } } }),
}));
vi.mock('@/features/notifications/PushSettingsCard', () => ({ PushSettingsCard: () => <div>push card</div> }));

import { MyAccountSheet } from './MyAccountSheet';
import { MyNotificationsSheet } from './MyNotificationsSheet';

const therapist: Therapist = {
  id: 't1',
  clinicId: 'c1',
  name: 'Ritu Sharma',
  active: true,
  userId: 'u1',
  registrationNo: 'KSPC-1',
  phone: '99999',
  updatedAt: '2026-01-01T00:00:00Z',
};

afterEach(() => {
  cleanup();
  put.mockClear();
  signOut.mockClear();
});

describe('MyNotificationsSheet', () => {
  it('shows the email switch only for a linked therapist, and saves the opt-out', async () => {
    const { rerender } = render(
      <MyNotificationsSheet open onClose={() => {}} role="front_desk" therapist={undefined} />
    );
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('push card')).toBeInTheDocument();

    rerender(<MyNotificationsSheet open onClose={() => {}} role="therapist" therapist={therapist} />);
    const toggle = screen.getByRole('switch', { name: /email me appointment updates/i });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][0]).toMatchObject({ id: 't1', emailAppointmentUpdates: false });
  });

  it('treats an older row with no value as on', () => {
    render(<MyNotificationsSheet open onClose={() => {}} role="therapist" therapist={therapist} />);
    expect(screen.getByRole('switch')).toBeChecked();
  });
});

describe('MyAccountSheet', () => {
  const base = {
    open: true,
    onClose: () => {},
    clinicId: 'c1',
    displayName: 'Ritu',
    fallbackName: 'ritu',
    setDisplayName: vi.fn().mockResolvedValue(undefined),
    hasPasswordIdentity: true,
    onChangePassword: () => {},
  };

  it('saves only name, registration no. and phone on the therapist row', async () => {
    render(<MyAccountSheet {...base} therapist={therapist} />);
    fireEvent.change(screen.getByLabelText(/name on invoices/i), { target: { value: 'Dr. Ritu Sharma' } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '88888' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const saved = put.mock.calls[0][0] as Therapist;
    expect(saved).toMatchObject({ id: 't1', userId: 'u1', active: true, name: 'Dr. Ritu Sharma', phone: '88888' });
  });

  it('shows no therapist fields for someone without a linked profile', () => {
    render(<MyAccountSheet {...base} therapist={undefined} />);
    expect(screen.queryByLabelText(/name on invoices/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('ritu@clinic.test');
  });

  it('signs out other devices only after confirming', async () => {
    render(<MyAccountSheet {...base} therapist={undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out of other devices' }));
    expect(signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out other devices' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ scope: 'others' }));
  });
});
