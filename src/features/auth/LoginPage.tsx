import { useState, type FormEvent } from 'react';
import { getSupabase } from '@/lib/supabase';
import { hasSupabaseConfig } from '@/lib/env';
import { toFriendlyMessage } from '@/lib/errors';
import { Field, inputCls, btnPrimary, ErrorNote, AuthBrandHeader } from '@/components/ui';

/** Google's official four-color "G" mark, per Google's Sign in with Google
 *  branding guidelines — this is the one piece of UI that must render the
 *  same regardless of the app's own theme, so it's plain markup rather than
 *  a themed icon component. */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

/** Google's "light" branded button — fixed white/grey per Google's own
 *  brand guidelines rather than the app's theme tokens, so it stays
 *  recognizable as the Google button in both light and dark mode. */
function GoogleButton({
  onClick,
  busy,
  label,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-3 rounded-md border border-[#dadce0] bg-white px-4 py-2 text-sm font-medium text-[#3c4043] shadow-sm transition-shadow hover:shadow-md disabled:opacity-50"
    >
      <GoogleIcon />
      {label}
    </button>
  );
}

export function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

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
    setBusy(false);
    if (error) {
      let message = error.message;
      if (error.message.includes('Invalid login credentials')) {
        message = 'Incorrect email or password.';
      } else if (error.message.includes('Email not confirmed')) {
        message = 'Please check your email to confirm your account before signing in.';
      } else if (error.message.includes('too many')) {
        message = 'Too many login attempts. Please try again in a few minutes.';
      }
      console.error('Sign in error:', error);
      setError(message);
    }
  }

  async function onSignup(e: FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
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
    setBusy(false);
    if (error) {
      if (error.message.includes('rate limit')) {
        setError('Too many password reset requests. Please wait a few minutes and try again.');
        return;
      }
      console.error('Password reset error:', error);
    }
    // Always show the same success message — avoids revealing whether the email exists.
    setResetSent(true);
  }

  async function onGoogleSignIn() {
    setBusy(true);
    setError(null);
    const { error } = await getSupabase()!.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/reset-password`,
      },
    });
    setBusy(false);
    if (error) {
      console.error('Google sign in error:', error);
      setError(error.message || 'Failed to sign in with Google');
    }
  }

  if (mode === 'signup') {
    return (
      <div className="mx-auto mt-24 max-w-sm">
        <AuthBrandHeader subtitle="Create an account" />
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
            <>
              <GoogleButton onClick={onGoogleSignIn} busy={busy} label="Sign up with Google" />
              <ErrorNote message={error} />
              <div className="relative flex items-center">
                <div className="flex-grow border-t border-[var(--border)]" />
                <span className="mx-2 text-xs text-[var(--muted)]">or</span>
                <div className="flex-grow border-t border-[var(--border)]" />
              </div>
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
            </>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'reset') {
    return (
      <div className="mx-auto mt-24 max-w-sm">
        <AuthBrandHeader subtitle="Reset your password" />
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
      <AuthBrandHeader subtitle="Sign in" />
      <div className="space-y-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6">
        <GoogleButton onClick={onGoogleSignIn} busy={busy} label="Sign in with Google" />
        <ErrorNote message={error} />
        <div className="relative flex items-center">
          <div className="flex-grow border-t border-[var(--border)]" />
          <span className="mx-2 text-xs text-[var(--muted)]">or</span>
          <div className="flex-grow border-t border-[var(--border)]" />
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
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
                setEmail('');
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
    </div>
  );
}
