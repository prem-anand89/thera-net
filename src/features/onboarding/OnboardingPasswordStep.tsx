import { useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { toFriendlyMessage } from '@/lib/errors';
import { btnPrimary, btnSecondary, inputCls, ErrorNote, Field } from '@/components/ui';

export function OnboardingPasswordStep({
  onSkip,
  onDone,
  nested = false,
}: {
  onSkip: () => void;
  onDone: () => void;
  /** True when the page around it already has its own main heading: this one then becomes a level-2 heading. */
  nested?: boolean;
}) {
  const Heading = nested ? 'h2' : 'h1';
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
        <Heading className={`font-display font-semibold leading-tight text-[var(--ink)] ${nested ? 'text-lg' : 'text-2xl'}`}>Add a password</Heading>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Optional. A password lets you sign in with your email too, for example on a shared clinic computer or when
          Google isn&apos;t available.
        </p>
      </div>
      <div className="rounded-xl border border-[var(--teal-light)] bg-[var(--teal-light)]/40 p-3 text-xs text-[var(--muted)]">
        You can add one any time from your account menu, under My account.
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
