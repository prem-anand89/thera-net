// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const plan = { maxMembers: 1, maxRosterTherapists: 1 as number | null, tier: 'lite', loading: false, enforcementEnabled: true };
const roster: { id: string; userId: string | null; name: string; active?: boolean; registrationNo?: string | null; phone?: string | null }[] = [];
const put = vi.fn();
const invoke = vi.fn();

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (q: () => unknown) => q() }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
vi.mock('@/app/useSession', () => ({ useSession: () => ({ session: { user: { id: 'me' } } }) }));
vi.mock('@/app/useClinicRole', () => ({ useClinicRole: () => ({ displayName: 'Dr Prem' }) }));
vi.mock('@/app/useEntitlements', () => ({ useEntitlements: () => plan }));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  }),
}));
vi.mock('@/services', () => ({
  repos: { therapists: { list: () => roster, put: (...a: unknown[]) => put(...a) } },
}));

import { OnboardingTeamStep } from './OnboardingTeamStep';

describe('OnboardingTeamStep', () => {
  beforeEach(() => {
    roster.length = 0;
    plan.maxMembers = 1;
    plan.maxRosterTherapists = 1;
    put.mockReset();
    invoke.mockReset();
  });
  afterEach(cleanup);

  it('on a one-login plan offers a colleague without a login instead of an invite that would fail', () => {
    render(<OnboardingTeamStep onContinue={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Add a colleague without a login' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send invite' })).toBeNull();
    expect(screen.getByText(/come with the Clinic plan \(5 logins\)/)).toBeInTheDocument();
  });

  it('on a plan with several logins keeps the invite form', () => {
    plan.maxMembers = 5;
    render(<OnboardingTeamStep onContinue={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add a colleague without a login' })).toBeNull();
  });

  it('adds a colleague with no login, up to what the plan includes', async () => {
    render(<OnboardingTeamStep onContinue={vi.fn()} />);
    await userEvent.type(screen.getAllByRole('textbox').find((el) => (el as HTMLInputElement).placeholder === 'Dr. …')!, 'Dr Kiran');
    await userEvent.click(screen.getByRole('button', { name: 'Add colleague' }));
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ name: 'Dr Kiran', userId: null, active: true }));
    expect(await screen.findByText('Dr Kiran · added')).toBeInTheDocument();
  });

  it('refuses a colleague when the plan allows none more', () => {
    roster.push({ id: 'k', userId: null, name: 'Dr Kiran' });
    render(<OnboardingTeamStep onContinue={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add colleague' })).toBeDisabled();
    expect(screen.getByText(/all in use|that one is in use/)).toBeInTheDocument();
  });

  it('continuing links the owner with name, registration and phone, and confirms the profile so Workspace is not intercepted', async () => {
    const onContinue = vi.fn();
    render(<OnboardingTeamStep onContinue={onContinue} />);
    await userEvent.type(screen.getByLabelText('Registration / council no. (optional)'), 'KA-1234');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onContinue).toHaveBeenCalled());
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'me', name: 'Dr Prem', registrationNo: 'KA-1234', profileConfirmedAt: expect.any(String) })
    );
  });

  it('skipping "I treat patients" does not touch the roster', async () => {
    const onContinue = vi.fn();
    render(<OnboardingTeamStep onContinue={onContinue} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /I treat patients/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onContinue).toHaveBeenCalled());
    expect(put).not.toHaveBeenCalled();
  });
});
