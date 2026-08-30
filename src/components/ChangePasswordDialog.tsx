import { useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { toFriendlyMessage } from '@/lib/errors';
import { btnPrimary, btnSecondary, inputCls, ErrorNote, Field } from '@/components/ui';

/**
 * Lets an already-signed-in member set a new password from the account
 * menu, not just at invite/recovery time. `ResetPasswordPage.tsx` handles
 * those two — it needs to establish a session from an email link's token
 * first — but here a valid session already exists, so this just calls
 * `updateUser` directly, same underlying Supabase call.
 */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

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
    const { error } = await getSupabase()!.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(toFriendlyMessage(error));
      return;
    }
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        className="w-full max-w-sm space-y-4 rounded-2xl bg-[var(--surface)] p-4 sm:p-5"
      >
        {done ? (
          <>
            <h2 id="change-password-title" className="text-sm font-semibold text-[var(--ink)]">
              Password updated
            </h2>
            <p className="text-sm text-[var(--ink)]">Your password has been changed.</p>
            <div className="flex justify-end">
              <button type="button" className={btnPrimary} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="change-password-title" className="text-sm font-semibold text-[var(--ink)]">
              Change password
            </h2>
            <Field label="New password">
              <input
                type="password"
                autoFocus
                minLength={8}
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="Confirm new password">
              <input
                type="password"
                minLength={8}
                className={inputCls}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <ErrorNote message={error} />
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? 'Saving…' : 'Save password'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
