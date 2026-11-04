// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mockNavigate = vi.fn();
let mockSession: { user: { id: string; identities?: { provider: string }[] } } | null = {
  user: { id: 'u1', identities: [{ provider: 'email' }] },
};
let mockTherapists: { id: string; clinicId: string; userId: string | null; name: string; registrationNo?: string | null; phone?: string | null }[] = [];
const mockPut = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => ({ id: 'c1', name: 'Elite Physio' }),
}));

vi.mock('@/app/useSession', () => ({
  useSession: () => ({ session: mockSession }),
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn: () => unknown) => fn(),
}));

vi.mock('@/services', () => ({
  repos: {
    therapists: {
      list: () => mockTherapists,
      put: (...a: unknown[]) => mockPut(...a),
    },
  },
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      updateUser: vi.fn().mockResolvedValue({ error: null }),
    },
  }),
}));

import { TherapistProfileOnboardingPage } from './TherapistProfileOnboardingPage';

describe('TherapistProfileOnboardingPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockPut.mockReset();
    mockSession = { user: { id: 'u1', identities: [{ provider: 'email' }] } };
    mockTherapists = [
      { id: 't1', clinicId: 'c1', userId: 'u1', name: 'Dr. John', registrationNo: 'REG123', phone: '9876543210' },
    ];
  });
  afterEach(cleanup);

  it('greets the therapist with the clinic name on the profile form', () => {
    render(<TherapistProfileOnboardingPage />);
    expect(screen.getByRole('heading', { name: 'Welcome to Elite Physio' })).toBeInTheDocument();
    expect(screen.getByText(/How you appear on bills/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dr. John')).toBeInTheDocument();
  });

  it('greets with clinic name when login is not linked to a roster row', () => {
    mockTherapists = [];
    render(<TherapistProfileOnboardingPage />);
    expect(screen.getByRole('heading', { name: 'Welcome to Elite Physio' })).toBeInTheDocument();
    expect(screen.getByText(/Your login isn't linked to a service roster row yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to Workspace' })).toBeInTheDocument();
  });

  it('offers optional password step when user signed in without password identity', async () => {
    // Google OAuth only
    mockSession = { user: { id: 'u1', identities: [{ provider: 'google' }] } };
    render(<TherapistProfileOnboardingPage />);

    expect(screen.getByRole('heading', { name: 'Welcome to Elite Physio' })).toBeInTheDocument();
    // One main heading on the page; the password step's own heading is level 2 and does not claim Google.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Add a password', level: 2 })).toBeInTheDocument();
    expect(screen.queryByText(/signed up with Google/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();

    // Skipping advances to the profile form
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByText(/How you appear on bills/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dr. John')).toBeInTheDocument();
  });

  it('saves updated profile and navigates to Workspace', async () => {
    render(<TherapistProfileOnboardingPage />);
    const nameInput = screen.getByLabelText(/Name on invoices/);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Dr. John Doe');

    await userEvent.click(screen.getByRole('button', { name: 'Go to Workspace' }));
    await waitFor(() => expect(mockPut).toHaveBeenCalled());
    expect(mockPut).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 't1',
        name: 'Dr. John Doe',
        profileConfirmedAt: expect.any(String),
      })
    );
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/workspace' });
  });
});
