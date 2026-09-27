import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { getSupabase } from '@/lib/supabase';
import { repos } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { Field, inputCls, btnPrimary, btnSecondary, ErrorNote } from '@/components/ui';
import { useClinicRole } from '@/app/useClinicRole';

export function OnboardingTeamStep({ onContinue }: { onContinue: () => void }) {
  const clinic = useClinic();
  const { displayName } = useClinicRole(clinic.id);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id), [clinic.id]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const selfOnRoster = therapists?.some((t) => t.name === displayName || t.userId);

  async function sendInvite() {
    if (!inviteEmail.trim() || !inviteName.trim()) {
      setInviteError('Name and email are required');
      return;
    }
    setInviteBusy(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error('No Supabase connection');
      const session = await supabase.auth.getSession();
      if (!session.data.session?.access_token) throw new Error('Not authenticated');

      const { data: result, error: invokeError } = await supabase.functions.invoke('invite-therapist', {
        body: {
          clinicId: clinic.id,
          email: inviteEmail.trim(),
          role: 'therapist',
          name: inviteName.trim(),
          redirectOrigin: window.location.origin,
        },
      });
      if (invokeError) throw new Error(invokeError.message);
      const payload = result as { error?: string; message?: string; warning?: string } | null;
      if (payload?.error) throw new Error(payload.error);
      const base = payload?.message || `Invitation sent to ${inviteEmail}`;
      setInviteSuccess(payload?.warning ? `${base}. ${payload.warning}` : base);
      setInviteEmail('');
      setInviteName('');
    } catch (e) {
      setInviteError(toFriendlyMessage(e));
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-semibold text-[var(--ink)]">Your team</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Invite colleagues now or from Settings later. If you treat patients, make sure you appear on the
          service roster with a linked login.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm font-semibold text-[var(--ink)]">{displayName || 'You'}</p>
        <p className="text-xs text-[var(--muted)]">
          Admin · {selfOnRoster ? 'On service roster' : 'Not on roster yet — add yourself in Settings → Team if you treat patients'}
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--paper)] p-4">
        <p className="mb-2 text-xs font-semibold text-[var(--muted)]">Invite a therapist</p>
        <div className="space-y-2">
          <Field label="Name">
            <input
              className={inputCls}
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="Dr. …"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              className={inputCls}
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@clinic.com"
            />
          </Field>
          <button
            type="button"
            className={btnSecondary}
            disabled={inviteBusy}
            onClick={() => void sendInvite()}
          >
            {inviteBusy ? 'Sending…' : 'Send invite'}
          </button>
          {inviteSuccess && <p className="text-xs text-[var(--moss)]">{inviteSuccess}</p>}
          <ErrorNote message={inviteError} />
        </div>
      </div>

      <button type="button" className={btnPrimary} onClick={onContinue}>
        Continue
      </button>
    </div>
  );
}
