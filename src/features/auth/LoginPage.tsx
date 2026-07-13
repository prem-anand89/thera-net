import { useState, type FormEvent } from 'react';
import { getSupabase } from '@/lib/supabase';
import { hasSupabaseConfig } from '@/lib/env';
import { toFriendlyMessage } from '@/lib/errors';
import { Field, inputCls, btnPrimary, ErrorNote } from '@/components/ui';

export function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  if (!hasSupabaseConfig) {
    return (
      <div className="mx-auto mt-24 max-w-md rounded-[10px] border border-[var(--rust)] bg-[var(--rust-light)] p-6 text-sm text-[var(--rust)]">
        <h1 className="font-display mb-2 text-base font-semibold">Supabase not configured</h1>
        <p>
          Copy <code>.env.example</code> to <code>.env</code> and fill in your Supabase project URL
          and anon key, then restart the dev server. See the README for the one-time project setup
          (migrations, seed, users).
        </p>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getSupabase()!.auth.signInWithPassword({ email, password });
    if (error) setError(toFriendlyMessage(error));
    setBusy(false);
  }

  const [signupSuccess, setSignupSuccess] = useState(false);

  async function onSignup(e: FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await getSupabase()!.auth.signUp({ email, password });
    setBusy(false);
    if (error) {
      setError(toFriendlyMessage(error));
    } else {
      setSignupSuccess(true);
      setPassword('');
      setConfirmPassword('');
    }
  }

  async function onRequestReset(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getSupabase()!.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) setError(toFriendlyMessage(error));
    else setResetSent(true);
    setBusy(false);
  }

  if (mode === 'signup') {
    return (
      <div className="mx-auto mt-24 max-w-sm">
        <h1 className="font-display mb-1 text-center text-xl font-semibold text-[var(--ink)]">Thera.Net</h1>
        <p className="mb-6 text-center text-sm text-[var(--muted)]">Create an account</p>
        <div className="space-y-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6">
          {signupSuccess ? (
            <>
              <p className="text-sm text-[var(--ink)]">
                Account created! Sign in with your email address and password.
              </p>
              <button
                type="button"
                className="w-full text-center text-xs text-[var(--muted)] hover:text-[var(--ink)]"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setSignupSuccess(false);
                }}
              >
                ← Back to sign in
              </button>
            </>
          ) : (
            <form onSubmit={onSignup} className="space-y-4">
              <Field label="Email">
                <input
                  type="email"
                  required
                  className={inputCls}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  required
                  minLength={6}
                  className={inputCls}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Confirm Password">
                <input
                  type="password"
                  required
                  minLength={6}
                  className={inputCls}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>
              <ErrorNote message={error} />
              <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
                {busy ? 'Creating account…' : 'Sign up'}
              </button>
              <button
                type="button"
                className="w-full text-center text-xs text-[var(--muted)] hover:text-[var(--ink)]"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setPassword('');
                  setConfirmPassword('');
                }}
              >
                ← Back to sign in
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'reset') {
    return (
      <div className="mx-auto mt-24 max-w-sm">
        <h1 className="font-display mb-1 text-center text-xl font-semibold text-[var(--ink)]">Thera.Net</h1>
        <p className="mb-6 text-center text-sm text-[var(--muted)]">Reset your password</p>
        <div className="space-y-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6">
          {resetSent ? (
            <p className="text-sm text-[var(--ink)]">
              If an account exists for <span className="font-medium">{email}</span>, a reset link
              has been sent — check your email and follow the link to choose a new password.
            </p>
          ) : (
            <form onSubmit={onRequestReset} className="space-y-4">
              <Field label="Email">
                <input
                  type="email"
                  required
                  className={inputCls}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <ErrorNote message={error} />
              <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}
          <button
            type="button"
            className="w-full text-center text-xs text-[var(--muted)] hover:text-[var(--ink)]"
            onClick={() => {
              setMode('signin');
              setError(null);
              setResetSent(false);
            }}
          >
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-24 max-w-sm">
      <h1 className="font-display mb-1 text-center text-xl font-semibold text-[var(--ink)]">Thera.Net</h1>
      <p className="mb-6 text-center text-sm text-[var(--muted)]">Patient visit ledger</p>
      <form onSubmit={onSubmit} className="space-y-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6">
        <Field label="Email">
          <input
            type="email"
            required
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            required
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorNote message={error} />
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="text-center text-xs text-[var(--muted)] hover:text-[var(--ink)]"
            onClick={() => {
              setMode('reset');
              setError(null);
            }}
          >
            Forgot password?
          </button>
          <button
            type="button"
            className="text-center text-xs text-[var(--muted)] hover:text-[var(--ink)]"
            onClick={() => {
              setMode('signup');
              setError(null);
              setPassword('');
            }}
          >
            Don't have an account? Sign up
          </button>
        </div>
        <p className="text-xs text-[var(--muted)]">
          First sign-in needs a connection; after that the app works offline and syncs when back
          online.
        </p>
      </form>
    </div>
  );
}
