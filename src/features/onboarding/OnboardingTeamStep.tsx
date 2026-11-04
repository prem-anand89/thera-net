import { edgeFunctionErrorMessage } from '@/lib/edgeFunctionError';
import { nextUnusedColor, therapistColor } from '@/components/schedule/scheduleColors';
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { useSession } from '@/app/useSession';
import { getSupabase } from '@/lib/supabase';
import { repos } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { Field, inputCls, btnPrimary, btnSecondary, ErrorNote } from '@/components/ui';
import { useClinicRole } from '@/app/useClinicRole';
import { PhoneField } from '@/components/PhoneField';
import { useEntitlements } from '@/app/useEntitlements';
import { PLAN_TIER_LABELS, TIER_LIMITS, loginsLabel, nextTierWithMore } from '@/domain/plans';
import { rosterAddBlocked, rosterLimitMessage } from '@/domain/roster';

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
  const entitlements = useEntitlements(clinic.id);
  // One login on this plan: nobody else can be invited, so the invite form would only fail. Offer a colleague without
  // a login instead (the plan includes some), and say what more logins need.
  const seatLimited = entitlements.enforcementEnabled && !entitlements.loading && entitlements.maxMembers <= 1;
  const rosterLimit = entitlements.enforcementEnabled && !entitlements.loading ? entitlements.maxRosterTherapists : null;
  const nextForSeats = nextTierWithMore(entitlements.tier, 'seats');

  const [iTreat, setITreat] = useState(true);
  const [rosterName, setRosterName] = useState('');
  // What prints on invoices, asked here so the creator is not sent to a second "How you appear on bills" form.
  const [registrationNo, setRegistrationNo] = useState('');
  const [phone, setPhone] = useState('');
  const [colleagueName, setColleagueName] = useState('');
  const [colleagueBusy, setColleagueBusy] = useState(false);
  const [colleagueError, setColleagueError] = useState<string | null>(null);
  const [addedColleagues, setAddedColleagues] = useState<string[]>([]);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [continueBusy, setContinueBusy] = useState(false);
  const [sentInvites, setSentInvites] = useState<{ name: string; email: string }[]>([]);

  useEffect(() => {
    if (selfRow) {
      setITreat(true);
      setRosterName(selfRow.name);
      setRegistrationNo(selfRow.registrationNo ?? '');
      setPhone(selfRow.phone ?? '');
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
        registrationNo: registrationNo.trim() || null,
        phone: phone.trim() || null,
        // Confirmed here, so the first visit to Workspace is not intercepted by the "How you appear on bills" page.
        profileConfirmedAt: now,
        updatedAt: now,
      });
    } else {
      const existing = await repos.therapists.list(clinic.id, true);
      await repos.therapists.put({
        id: crypto.randomUUID(),
        clinicId: clinic.id,
        name,
        userId,
        active: true,
        registrationNo: registrationNo.trim() || null,
        phone: phone.trim() || null,
        profileConfirmedAt: now,
        // A new therapist starts with a color nobody else uses.
        color: nextUnusedColor(existing.filter((t) => t.active !== false).map((t) => therapistColor(t.id, t.color))),
        updatedAt: now,
      });
    }
  }

  async function addColleague() {
    const name = colleagueName.trim();
    if (!name) {
      setColleagueError('Type their name.');
      return;
    }
    if (rosterAddBlocked(therapists ?? [], rosterLimit)) {
      setColleagueError(rosterLimit === null ? '' : rosterLimitMessage(rosterLimit));
      return;
    }
    setColleagueBusy(true);
    setColleagueError(null);
    try {
      const existing = await repos.therapists.list(clinic.id, true);
      await repos.therapists.put({
        id: crypto.randomUUID(),
        clinicId: clinic.id,
        name,
        active: true,
        userId: null,
        color: nextUnusedColor(existing.filter((t) => t.active !== false).map((t) => therapistColor(t.id, t.color))),
        updatedAt: new Date().toISOString(),
      });
      setAddedColleagues((list) => [...list, name]);
      setColleagueName('');
    } catch (e) {
      setColleagueError(toFriendlyMessage(e));
    } finally {
      setColleagueBusy(false);
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
      if (invokeError) throw new Error(await edgeFunctionErrorMessage(invokeError));
      const payload = result as { error?: string; message?: string; warning?: string } | null;
      if (payload?.error) throw new Error(payload.error);
      const base = payload?.message || `Invitation sent to ${inviteEmail}`;
      setInviteSuccess(payload?.warning ? `${base}. ${payload.warning}` : base);
      setSentInvites((list) => [...list, { name: inviteName.trim(), email: inviteEmail.trim() }]);
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
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold leading-tight text-[var(--ink)]">Your team</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {seatLimited
            ? 'Your plan has one login. If you treat patients, add yourself to the team; you can add a colleague without a login too.'
            : 'Invite colleagues now or from Settings later. If you treat patients, add yourself to the team with this login.'}
        </p>
      </div>

      <div className="grid gap-4 tab:grid-cols-2 tab:gap-6">
        <section aria-labelledby="onboarding-you" className="space-y-4 rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
          <h2 id="onboarding-you" className="font-display text-base font-semibold text-[var(--ink)]">
            You
          </h2>
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-[var(--ink)]">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--teal)]"
              checked={iTreat}
              onChange={(e) => setITreat(e.target.checked)}
            />
            I treat patients at this clinic
          </label>
          {iTreat ? (
            <>
              <Field label="Name on invoices">
                <input
                  className={inputCls}
                  value={rosterName}
                  onChange={(e) => setRosterName(e.target.value)}
                  placeholder="As patients should see it"
                />
              </Field>
              <Field label="Registration / council no. (optional)">
                <input
                  className={inputCls}
                  value={registrationNo}
                  onChange={(e) => setRegistrationNo(e.target.value)}
                  placeholder="Insurers check this on invoices"
                />
              </Field>
              <Field label="Phone (optional)" htmlFor="onboarding-phone">
                <PhoneField id="onboarding-phone" value={phone} onChange={setPhone} />
              </Field>
              <p className="text-xs text-[var(--muted)]">
                {selfRow
                  ? 'Linked to your login. You can change these anytime in Settings → Team.'
                  : 'We will add you to the team and link this login when you continue.'}
              </p>
            </>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              Skipping roster linking is fine. You can manage the clinic and invite therapists later.
            </p>
          )}
          <ErrorNote message={linkError} />
        </section>

        {entitlements.loading ? null : seatLimited ? (
        <section aria-labelledby="onboarding-colleague" className="space-y-4 rounded-[20px] border border-[var(--border)] bg-[var(--paper)] p-4 sm:p-6">
          <h2 id="onboarding-colleague" className="font-display text-base font-semibold text-[var(--ink)]">
            Add a colleague without a login
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Optional — skip if it&apos;s just you. You can invite people later in Settings → Team.
          </p>
          {addedColleagues.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Colleagues added">
              {addedColleagues.map((name) => (
                <li key={name} className="rounded-full bg-[var(--moss-light)] px-3 py-1 text-xs font-medium text-[var(--moss-strong)]">
                  {name} · added
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-[var(--muted)]">
            {rosterLimit !== null
              ? `Your plan includes ${rosterLimit} team member${rosterLimit === 1 ? '' : 's'} on the schedule without a login of their own. `
              : ''}
            They appear in the schedule and on visits; they cannot sign in.
          </p>
          <Field label="Name">
            <input
              className={inputCls}
              value={colleagueName}
              onChange={(e) => setColleagueName(e.target.value)}
              placeholder="Dr. …"
              disabled={rosterAddBlocked(therapists ?? [], rosterLimit)}
            />
          </Field>
          <button
            type="button"
            className={btnSecondary}
            disabled={colleagueBusy || rosterAddBlocked(therapists ?? [], rosterLimit)}
            onClick={() => void addColleague()}
          >
            {colleagueBusy ? 'Adding…' : 'Add colleague'}
          </button>
          {rosterAddBlocked(therapists ?? [], rosterLimit) && rosterLimit !== null && (
            <p className="text-xs text-[var(--muted)]">{rosterLimitMessage(rosterLimit)}</p>
          )}
          <ErrorNote message={colleagueError} />
          <p className="text-xs text-[var(--muted)]">
            {nextForSeats
              ? `Colleagues who sign in with their own login come with the ${PLAN_TIER_LABELS[nextForSeats]} plan (${loginsLabel(TIER_LIMITS[nextForSeats].seats)}).`
              : 'More logins are available on request.'}
          </p>
        </section>
        ) : (
        <section aria-labelledby="onboarding-invite" className="space-y-4 rounded-[20px] border border-[var(--border)] bg-[var(--paper)] p-4 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 id="onboarding-invite" className="font-display text-base font-semibold text-[var(--ink)]">
              Invite a therapist
            </h2>
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
              Optional
            </span>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Working alone? Leave this blank and tap Continue. You can invite people later in Settings → Team.
          </p>
          {sentInvites.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Invites sent">
              {sentInvites.map((invite) => (
                <li
                  key={invite.email}
                  className="rounded-full bg-[var(--moss-light)] px-3 py-1 text-xs font-medium text-[var(--moss-strong)]"
                >
                  {invite.name} · invite sent
                </li>
              ))}
            </ul>
          )}
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
          <button type="button" className={btnSecondary} disabled={inviteBusy} onClick={() => void sendInvite()}>
            {inviteBusy ? 'Sending…' : 'Send invite'}
          </button>
          {inviteSuccess && <p className="text-xs text-[var(--moss-strong)]">{inviteSuccess}</p>}
          <ErrorNote message={inviteError} />
        </section>
        )}
      </div>

      <button type="button" className={`${btnPrimary} w-full sm:w-auto`} disabled={continueBusy} onClick={() => void handleContinue()}>
        {continueBusy ? 'Saving…' : 'Continue'}
      </button>
    </div>
  );
}
