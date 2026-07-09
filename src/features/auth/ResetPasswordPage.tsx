import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { getSupabase } from '@/lib/supabase';
import { hasSupabaseConfig } from '@/lib/env';
import { toFriendlyMessage } from '@/lib/errors';
import { Field, inputCls, btnPrimary, ErrorNote } from '@/components/ui';

/**
 * Landing page for a Supabase password-recovery email link. Handles both
 * link shapes Supabase can send: an implicit-flow token in the URL fragment
 * (auto-detected by the client before this component mounts) and a PKCE
 * `?code=` query param (needs an explicit exchange, done below). Distinct
 * "checking" vs "invalid" states matter here — collapsing them meant a slow
 * check or an unhandled PKCE code both looked identical to a dead link.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!hasSupabaseConfig) return;
    const supabase = getSupabase()!;
    (async () => {
      const code = new URL(window.location.href).searchParams.get('code');
      if (code) await supabase.auth.exchangeCodeForSession(code);
      const { data } = await supabase.auth.getSession();
      setReady(Boolean(data.session));
      setChecking(false);
    })();
  }, []);

  if (!hasSupabaseConfig) {
    return (
      <div className="mx-auto mt-24 max-w-md rounded-[10px] border border-[var(--rust)] bg-[var(--rust-light)] p-6 text-sm text-[var(--rust)]">
        <h1 className="font-display mb-2 text-base font-semibold">Supabase not configured</h1>
        <p>Copy <code>.env.example</code> to <code>.env</code> and restart the dev server.</p>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error } = await getSupabase()!.auth.updateUser({ password });
    if (error) {
      setError(toFriendlyMessage(error));
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
  }

  return (
    <div className="mx-auto mt-24 max-w-sm">
      <h1 className="font-display mb-1 text-center text-xl font-semibold text-[var(--ink)]">Thera.Net</h1>
      <p className="mb-6 text-center text-sm text-[var(--muted)]">Choose a new password</p>
      <div className="space-y-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6">
        {checking ? (
          <p className="text-sm text-[var(--muted)]">Checking your link…</p>
        ) : done ? (
          <>
            <p className="text-sm text-[var(--ink)]">
              Password updated. You're signed in — continue to the app.
            </p>
            <button className={`${btnPrimary} w-full`} onClick={() => void navigate({ to: '/visits' })}>
              Continue
            </button>
          </>
        ) : !ready ? (
          <p className="text-sm text-[var(--muted)]">
            This link is invalid or has expired. Go back to the login page and request a new one.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="New password">
              <input
                type="password"
                required
                minLength={8}
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="Confirm new password">
              <input
                type="password"
                required
                minLength={8}
                className={inputCls}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <ErrorNote message={error} />
            <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
              {busy ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
