import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { useSession } from '@/app/useSession';
import { getSupabase } from '@/lib/supabase';
import { repos } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { Field, inputCls, btnPrimary, btnSecondary, ErrorNote } from '@/components/ui';
import { useClinicRole } from '@/app/useClinicRole';

export function OnboardingTeamStep({
  onContinue,
}: {
  onContinue: () => void | Promise<void>;
}) {
  const clinic = useClinic();
  const { session } = useSession();
  const userId = session?.user?.id;
  const { displayName } = useClinicRole(clinic.id);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id), [clinic.id]);
  const selfRow = therapists?.find((t) => t.userId === userId);

  const [iTreat, setITreat] = useState(true);
  const [rosterName, setRosterName] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [continueBusy, setContinueBusy] = useState(false);

  useEffect(() => {
    if (selfRow) {
      setITreat(true);
      setRosterName(selfRow.name);
    } else if (displayName) {
      setRosterName(displayName);
    }
  }, [selfRow, displayName]);

  async function linkSelfToRoster() {
    if (!userId) throw new Error('Not signed in');
    const name = rosterName.trim() || displayName?.trim() || 'Therapist';
    const now = new Date().toISOString();
    if (selfRow) {
      await repos.therapists.put({
        ...selfRow,
        name,
        userId,
        active: true,
        updatedAt: now,
      });
    } else {
      await repos.therapists.put({
        id: crypto.randomUUID(),
        clinicId: clinic.id,
        name,
        userId,
        active: true,
        updatedAt: now,
      });
    }
  }

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
      const authSession = await supabase.auth.getSession();
      if (!authSession.data.session?.access_token) throw new Error('Not authenticated');

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

  async function handleContinue() {
    setContinueBusy(true);
    setLinkError(null);
    try {
      if (iTreat) {
        await linkSelfToRoster();
      }
      await onContinue();
    } catch (e) {
      setLinkError(toFriendlyMessage(e));
    } finally {
      setContinueBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-semibold text-[var(--ink)]">Your team</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Invite colleagues now or from Settings later. If you treat patients, add yourself to the service
          roster with this login.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
          <input
            type="checkbox"
            checked={iTreat}
            onChange={(e) => setITreat(e.target.checked)}
          />
          I treat patients at this clinic
        </label>
        {iTreat && (
          <>
            <Field label="Your name on the roster">
              <input
                className={inputCls}
                value={rosterName}
                onChange={(e) => setRosterName(e.target.value)}
                placeholder="As patients should see it"
              />
            </Field>
            <p className="text-xs text-[var(--muted)]">
              {selfRow
                ? 'Linked to your login — you can refine invoice details on the next screens.'
                : 'We will add you to the roster and link this login when you continue.'}
            </p>
          </>
        )}
        {!iTreat && (
          <p className="text-xs text-[var(--muted)]">
            Skip roster linking — you can still manage the clinic and invite therapists later.
          </p>
        )}
        <ErrorNote message={linkError} />
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

      <button type="button" className={btnPrimary} disabled={continueBusy} onClick={() => void handleContinue()}>
        {continueBusy ? 'Saving…' : 'Continue'}
      </button>
    </div>
  );
}
