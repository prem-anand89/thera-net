import { useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { toFriendlyMessage } from '@/lib/errors';
import { btnPrimary, btnSecondary, inputCls, ErrorNote, Field } from '@/components/ui';

export function OnboardingPasswordStep({
  onSkip,
  onDone,
}: {
  onSkip: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
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
    const { error: updateError } = await getSupabase()!.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(toFriendlyMessage(updateError));
      return;
    }
    onDone();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-semibold text-[var(--ink)]">Sign in without Google?</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Optional — you signed up with Google. Add a password to also sign in with email on shared clinic
          devices or if Google isn&apos;t available.
        </p>
      </div>
      <div className="rounded-xl border border-[var(--teal-light)] bg-[var(--teal-light)]/40 p-3 text-xs text-[var(--muted)]">
        You can set a password anytime from your account menu (avatar → Set a password).
      </div>
      <Field label="New password">
        <input
          type="password"
          minLength={8}
          className={inputCls}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label="Confirm password">
        <input
          type="password"
          minLength={8}
          className={inputCls}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      <ErrorNote message={error} />
      <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save password'}
      </button>
      <button type="button" className={btnSecondary} disabled={busy} onClick={onSkip}>
        Skip for now
      </button>
    </div>
  );
}
