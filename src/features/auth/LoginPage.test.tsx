// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const signUp = vi.fn();
const resend = vi.fn();
const signInWithPassword = vi.fn();
vi.mock('@/lib/env', () => ({ hasSupabaseConfig: true }));
vi.mock('@/app/UnsyncedNotice', () => ({ UnsyncedNotice: () => null }));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      signUp: (...a: unknown[]) => signUp(...a),
      resend: (...a: unknown[]) => resend(...a),
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      signInWithOAuth: vi.fn(async () => ({ error: null })),
    },
  }),
}));

import { LoginPage } from './LoginPage';

const EMAIL = 'new.therapist@example.com';
const confirmUrl = `${window.location.origin}/workspace`;

function openSignup() {
  render(<LoginPage />);
  fireEvent.click(screen.getByRole('button', { name: /Sign up$/ }));
}

function submitSignup(email = EMAIL) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
  fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'secret123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
}

beforeEach(() => {
  signUp.mockReset().mockResolvedValue({ data: { user: { id: 'u1', identities: [{ id: 'i1' }] }, session: null }, error: null });
  resend.mockReset().mockResolvedValue({ data: {}, error: null });
  signInWithPassword.mockReset();
});
afterEach(cleanup);

describe('LoginPage sign-up', () => {
  it('after sign-up asks to confirm the email, names the address, and does not say "sign in"', async () => {
    openSignup();
    submitSignup();
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByText(/Spam/)).toBeInTheDocument();
    expect(screen.queryByText(/Account created! Sign in/)).not.toBeInTheDocument();
  });

  it('the confirmation link returns to this app', async () => {
    openSignup();
    submitSignup();
    await screen.findByText('Check your email');
    expect(signUp).toHaveBeenCalledWith({ email: EMAIL, password: 'secret123', options: { emailRedirectTo: confirmUrl } });
  });

  it('can resend the email from the same screen', async () => {
    openSignup();
    submitSignup();
    fireEvent.click(await screen.findByRole('button', { name: 'Resend email' }));
    await waitFor(() =>
      expect(resend).toHaveBeenCalledWith({ type: 'signup', email: EMAIL, options: { emailRedirectTo: confirmUrl } })
    );
    expect(await screen.findByText(/Sent again/)).toBeInTheDocument();
  });

  it('"Wrong address?" goes back to the form with the address kept', async () => {
    openSignup();
    submitSignup();
    fireEvent.click(await screen.findByRole('button', { name: /Wrong address/ }));
    expect(screen.getByLabelText('Email')).toHaveValue(EMAIL);
  });

  it('an address that already has an account says so instead of pretending an email was sent', async () => {
    signUp.mockResolvedValue({ data: { user: { id: 'u1', identities: [] }, session: null }, error: null });
    openSignup();
    submitSignup();
    expect(await screen.findByText(/already has an account/)).toBeInTheDocument();
    expect(screen.queryByText('Check your email')).not.toBeInTheDocument();
  });

  it('when the project does not require confirmation (a session comes back), no email screen is shown', async () => {
    signUp.mockResolvedValue({ data: { user: { id: 'u1', identities: [{ id: 'i1' }] }, session: { access_token: 't' } }, error: null });
    openSignup();
    submitSignup();
    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(screen.queryByText('Check your email')).not.toBeInTheDocument();
  });
});
