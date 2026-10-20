// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Therapist } from '@/domain/types';

const put = vi.fn().mockResolvedValue(undefined);
const setEnabled = vi.fn().mockResolvedValue(undefined);
let savedChoices: { category: string; enabled: boolean }[] = [];
const signOut = vi.fn().mockResolvedValue({ error: null });
vi.mock('@/services', () => ({
  repos: {
    therapists: { put: (t: unknown) => put(t) },
    userPushPreferences: {
      listForUser: () => Promise.resolve(savedChoices),
      setEnabled: (...args: unknown[]) => setEnabled(...args),
    },
  },
  bookingService: { setWorkingHours: vi.fn() },
}));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { signOut } }),
  publicTherapistPhotoUrl: () => null,
}));
vi.mock('@/app/useSession', () => ({
  useSession: () => ({ session: { user: { id: 'u1', email: 'ritu@clinic.test' } } }),
}));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
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
  setEnabled.mockClear();
  savedChoices = [];
  signOut.mockClear();
});

describe('MyNotificationsSheet', () => {
  it('shows the email switch only for a linked therapist, and saves the opt-out', async () => {
    const { rerender } = render(
      <MyNotificationsSheet open onClose={() => {}} role="front_desk" therapist={undefined} />
    );
    expect(screen.queryByRole('switch', { name: /email me appointment updates/i })).not.toBeInTheDocument();
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
    expect(screen.getByRole('switch', { name: /email me appointment updates/i })).toBeChecked();
  });

  it('offers only the alerts that apply to the role', () => {
    const names = () => screen.queryAllByRole('switch').map((el) => el.getAttribute('aria-label') ?? '');
    const { rerender } = render(<MyNotificationsSheet open onClose={() => {}} role="front_desk" therapist={undefined} />);
    expect(names()).toEqual(['New booking requests']);

    rerender(<MyNotificationsSheet open onClose={() => {}} role="admin" therapist={undefined} />);
    expect(names()).toEqual(['New booking requests', 'Low-rated feedback']);

    // An admin who is also a therapist gets appointment alerts too.
    rerender(<MyNotificationsSheet open onClose={() => {}} role="admin" therapist={therapist} />);
    expect(names().slice(0, 3)).toEqual(['New booking requests', 'Changes to my appointments', 'Low-rated feedback']);

    rerender(<MyNotificationsSheet open onClose={() => {}} role="therapist" therapist={therapist} />);
    expect(names().slice(0, 1)).toEqual(['Changes to my appointments']);
  });

  it('says to link the profile when a therapist login has no therapist profile', () => {
    render(<MyNotificationsSheet open onClose={() => {}} role="therapist" therapist={undefined} />);
    expect(screen.getByText(/link your login to your therapist profile/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('every alert is on by default, and switching one off saves it for this user and clinic', async () => {
    render(<MyNotificationsSheet open onClose={() => {}} role="admin" therapist={undefined} />);
    const toggle = screen.getByRole('switch', { name: 'Low-rated feedback' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith('u1', 'c1', 'low_rating_feedback', false));
  });

  it('shows an alert as off when it was switched off earlier (e.g. on another device)', async () => {
    savedChoices = [{ category: 'booking_request', enabled: false }];
    render(<MyNotificationsSheet open onClose={() => {}} role="admin" therapist={undefined} />);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'New booking requests' })).not.toBeChecked());
    expect(screen.getByRole('switch', { name: 'Low-rated feedback' })).toBeChecked();
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
    expect(saved).toMatchObject({ id: 't1', userId: 'u1', active: true, name: 'Dr. Ritu Sharma', phone: '+91 88888' });
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
