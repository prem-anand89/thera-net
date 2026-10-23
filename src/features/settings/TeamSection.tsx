import { notify } from '@/lib/notify';
import { TherapistColorPicker } from '@/components/schedule/TherapistColorPicker';
import { PhoneField } from '@/components/PhoneField';
import { edgeFunctionErrorMessage } from '@/lib/edgeFunctionError';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, therapistService } from '@/services';
import { colorClashes, nextUnusedColor, therapistColor } from '@/components/schedule/scheduleColors';
import { useClinic } from '@/app/clinicContext';
import { useEntitlements } from '@/app/useEntitlements';
import { CLINIC_ROLE_LABELS, type ClinicRole } from '@/app/useClinicRole';
import { PLAN_TIER_LABELS, minimumTierFor } from '@/domain/plans';
import { getSupabase, publicTherapistPhotoUrl } from '@/lib/supabase';
import { resizeImageToBlob } from '@/lib/resizeImage';
import { formatDateDM } from '@/domain/fiscalYear';
import { toLocalDateStr } from '@/domain/schedule';
import { type Clinic, type Therapist, type ShiftTemplate, type TherapistShiftAssignment } from '@/domain/types';
import { memberOnboardingStatus, MEMBER_ONBOARDING_LABELS, type MemberOnboardingStatus } from '@/domain/memberOnboarding';
import { Field, inputCls, btnPrimary, ErrorNote, SectionCard, ConfirmDialog, InfoTip } from '@/components/ui';
import { describeSchedule } from './shiftUtils';
import { countTherapistLinkedRecords } from './therapistLinks';
import { SetWorkingHoursFlow } from './SetWorkingHoursFlow';
import { toFriendlyMessage } from '@/lib/errors';
import { Accent, ACCENT_VARS } from './settingsShared';

interface ClinicMember {
  userId: string;
  email: string;
  role: string;
  displayName: string | null;
  status: MemberOnboardingStatus;
  invitedAt: string | null;
  lastSignInAt: string | null;
  lastActiveAt: string | null;
}

/** Same accent per role everywhere a role shows up as a colored pill or
 *  avatar in Settings → Team — admin teal, therapist moss, front_desk amber. */
const ROLE_ACCENT: Record<Exclude<ClinicRole, 'unknown'>, Accent> = {
  admin: 'teal',
  therapist: 'moss',
  front_desk: 'amber',
};

function RolePill({ role }: { role: Exclude<ClinicRole, 'unknown'> }) {
  const { color, light } = ACCENT_VARS[ROLE_ACCENT[role]];
  return (
    <span
      className="inline-block self-start rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
      style={{ background: light, color }}
    >
      {CLINIC_ROLE_LABELS[role]}
    </span>
  );
}

/** Slate (invited, nothing's happened yet) → amber (clicked the invite
 *  link, hasn't chosen a password) → moss (done). Caption dates from
 *  whichever timestamp actually moved for that state — invitedAt for the
 *  first, lastSignInAt (the moment the link was clicked) for the second —
 *  so the badge always answers "since when," not just "which state." */
function OnboardingBadge({ member }: { member: ClinicMember }) {
  const accent: Accent =
    member.status === 'active' ? 'moss' : member.status === 'link_opened' ? 'amber' : 'slate';
  const { color, light } = ACCENT_VARS[accent];
  const dateSuffix =
    member.status === 'invited' && member.invitedAt
      ? ` ${formatDateDM(member.invitedAt)}`
      : member.status === 'link_opened' && member.lastSignInAt
        ? ` ${formatDateDM(member.lastSignInAt)}`
        : '';
  return (
    <span
      className="inline-block self-start rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
      style={{ background: light, color }}
    >
      {MEMBER_ONBOARDING_LABELS[member.status]}
      {dateSuffix}
    </span>
  );
}

/** Same split-on-whitespace, first-two-initials logic already duplicated
 *  across the patient avatar spots (PatientsPage/PatientProfilePage/
 *  NoteEditorPage) — matched here rather than introducing a shared helper
 *  for a one-line computation. */
function therapistInitials(name: string): string {
  let text = name;
  if (text.includes('@')) {
    text = text.split('@')[0];
  }
  const parts = text.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return '';
}

interface TeamPerson {
  key: string;
  member: ClinicMember | null;
  therapist: Therapist | null;
}

function buildTeamList(members: ClinicMember[] | null, therapists: Therapist[] | null): TeamPerson[] {
  const map = new Map<string, TeamPerson>();
  
  if (members) {
    for (const m of members) {
      map.set(m.userId, { key: m.userId, member: m, therapist: null });
    }
  }
  
  if (therapists) {
    for (const t of therapists) {
      if (t.userId && map.has(t.userId)) {
        map.get(t.userId)!.therapist = t;
      } else {
        const key = t.userId ? t.userId : `t-${t.id}`;
        if (!map.has(key)) {
          map.set(key, { key, member: null, therapist: t });
        } else {
          map.get(key)!.therapist = t;
        }
      }
    }
  }
  
  return Array.from(map.values()).sort((a, b) => {
    const nameA = (a.member?.displayName || a.therapist?.name || a.member?.email || '').toLowerCase();
    const nameB = (b.member?.displayName || b.therapist?.name || b.member?.email || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

export type TeamMemberCardProps = {
  person: TeamPerson;
  clinicId: string;
  isLastAdmin: boolean;
  revoking: boolean;
  resending: boolean;
  onRevoke: () => void;
  onResend: () => void;
  onSaved: () => void;
  onDelete: () => void;
  onPhotoUpload: (file: File) => void;
  onDeactivate: () => void;
  assignments: TherapistShiftAssignment[];
  templates: ShiftTemplate[];
  clinic: Clinic;
};

export function TeamMemberCard({
  person,
  clinicId,
  isLastAdmin,
  revoking,
  resending,
  onRevoke,
  onResend,
  onSaved,
  onDelete,
  onPhotoUpload,
  onDeactivate,
  assignments,
  templates,
  clinic,
}: TeamMemberCardProps) {
  const { member, therapist } = person;
  const displayName = member?.displayName || therapist?.name || member?.email || 'Unknown';
  const role = member ? ((member.role as Exclude<ClinicRole, 'unknown'>) ?? 'therapist') : 'therapist';
  const { color, light } = ACCENT_VARS[ROLE_ACCENT[role] ?? 'slate'];

  const scheduleDesc = therapist
    ? describeSchedule(therapist, assignments, templates, clinic)
    : null;

  const [editing, setEditing] = useState(false);
  const [showHoursFlow, setShowHoursFlow] = useState(false);
  
  const [nameDraft, setNameDraft] = useState(displayName);
  const [roleDraft, setRoleDraft] = useState<ClinicRole>(role);
  const [emailDraft, setEmailDraft] = useState('');
  const [regDraft, setRegDraft] = useState(therapist?.registrationNo ?? '');
  const [phoneDraft, setPhoneDraft] = useState(therapist?.phone ?? '');
  const [colorDraft, setColorDraft] = useState(therapist?.color ?? '');
  // Colors other therapists already use, so the picker can mark them.
  const clinicRoster = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const colorsTakenByOthers = useMemo(
    () =>
      Object.fromEntries(
        (clinicRoster ?? [])
          .filter((t) => t.id !== therapist?.id && t.active !== false)
          .map((t) => [therapistColor(t.id, t.color).toLowerCase(), t.name])
      ),
    [clinicRoster, therapist?.id]
  );
  const [publicBookableDraft, setPublicBookableDraft] = useState(therapist ? therapist.publicBookable !== false : true);
  const [bookableDraft, setBookableDraft] = useState(therapist ? therapist.active !== false : role !== 'front_desk');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (isLastAdmin && roleDraft !== 'admin') {
      setError('This clinic must keep at least one admin — make someone else admin first.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (!member && therapist && emailDraft.trim()) {
        const supabase = getSupabase();
        if (!supabase) throw new Error('No Supabase connection');
        const { data: result, error: invokeError } = await supabase.functions.invoke(
          'invite-therapist',
          {
            body: {
              action: 'invite',
              clinicId,
              email: emailDraft.trim(),
              name: nameDraft.trim(),
              role: roleDraft,
              redirectOrigin: window.location.origin,
            },
          }
        );
        if (invokeError) throw new Error(await edgeFunctionErrorMessage(invokeError));
        const payload = result as { error?: string; success?: boolean } | null;
        if (payload?.error) throw new Error(payload.error);
      } else if (member) {
        const supabase = getSupabase();
        if (!supabase) throw new Error('No Supabase connection');
        const { error: updateError } = await supabase
          .from('clinic_members')
          .update({
            display_name: nameDraft.trim() || null,
            // Only touch role when the admin actually changed it; a stale
            // draft must never silently demote/promote a member.
            ...(roleDraft !== role ? { role: roleDraft } : {}),
          })
          .eq('clinic_id', clinicId)
          .eq('user_id', member.userId);
        if (updateError) throw updateError;
      }

      const isNowFrontDesk = roleDraft === 'front_desk';
      const shouldBeBookable = !isNowFrontDesk && bookableDraft;

      if (therapist) {
        await repos.therapists.put({
          ...therapist,
          name: nameDraft.trim() || therapist.name,
          active: shouldBeBookable,
          registrationNo: isNowFrontDesk ? null : regDraft.trim() || null,
          phone: phoneDraft.trim() || null,
          color: colorDraft.trim() || null,
          publicBookable: shouldBeBookable ? publicBookableDraft : false,
          updatedAt: new Date().toISOString(),
        });
      } else if (shouldBeBookable && member) {
        const existing = await repos.therapists.list(clinicId, true);
        const others = existing.filter((t) => t.active !== false);
        await repos.therapists.put({
          id: crypto.randomUUID(),
          clinicId,
          name: nameDraft.trim() || displayName || 'Therapist',
          active: true,
          userId: member.userId,
          publicBookable: publicBookableDraft,
          color: colorDraft.trim() || nextUnusedColor(others.map((t) => therapistColor(t.id, t.color))),
          registrationNo: regDraft.trim() || null,
          phone: phoneDraft.trim() || null,
          updatedAt: new Date().toISOString(),
        });
      }
      
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const renderPhoto = (sizeClass: string) => (
    <label
      className={`block shrink-0 cursor-pointer overflow-hidden rounded-full border border-[var(--border)] bg-[var(--paper)] ${sizeClass}`}
      title={therapist ? "Change photo" : "No photo available"}
      onClick={(e) => { if (!therapist) e.preventDefault(); }}
    >
      {therapist?.photoPath ? (
        <img
          src={publicTherapistPhotoUrl(therapist.photoPath) ?? ''}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center font-display text-sm font-semibold text-white"
          style={{ background: color, boxShadow: `0 0 0 3px ${light}` }}
        >
          {therapistInitials(displayName)}
        </span>
      )}
      {therapist && (
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPhotoUpload(file);
            e.target.value = '';
          }}
        />
      )}
    </label>
  );



  const isUnlinkedTherapist = !member && therapist;
  const isBookable = !!therapist && role !== 'front_desk' && therapist.active !== false;

  return (
    <div className={`flex h-full flex-col gap-3 rounded-2xl border ${therapist && therapist.active === false ? 'border-dashed border-[var(--border)] bg-[var(--paper)] opacity-80' : 'border-[var(--border)] bg-[var(--surface)] shadow-sm'} p-4 transition-all`}>
      {/* Header section */}
      <div className="flex items-start gap-3">
        <div className="shrink-0">{renderPhoto('h-10 w-10')}</div>
        
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <h3 className="truncate text-base font-bold text-[var(--ink)] tracking-tight">{displayName}</h3>
            
            <div className="flex flex-wrap items-center gap-1.5">
              {member && <RolePill role={role} />}
              {member && member.status !== 'active' && <OnboardingBadge member={member} />}
              {member?.lastActiveAt && toLocalDateStr(new Date(member.lastActiveAt)) === toLocalDateStr(new Date()) && (
                <span className="inline-block rounded-full bg-[var(--moss-light)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--moss)]">
                  Active today
                </span>
              )}
              {isBookable && (
                <span className="inline-block rounded-full bg-[var(--sky-light)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--sky)]">
                  Bookable
                </span>
              )}
              {therapist && therapist.publicBookable === false && (
                <span className="inline-block rounded-full bg-[var(--paper)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--muted)]" title="Not offered on the public online-booking page">
                  Hidden online
                </span>
              )}
              {!member && therapist && (
                <span className="inline-block rounded-full bg-[var(--amber-light)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--amber-strong)]">
                  No login
                </span>
              )}
            </div>
          </div>
          
          <div className="flex items-start gap-1.5 mt-1.5 text-xs text-[var(--muted)]">
            <div className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${(!therapist || therapist.active) ? 'bg-[var(--moss-strong)]' : 'bg-[var(--muted)]'}`} />
            <span className="leading-tight">
              {(!therapist || therapist.active) ? 'Active' : 'Inactive roster'}
              {member?.lastSignInAt && ` · Last seen ${new Date(member.lastSignInAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2.5 text-xs text-[var(--ink)] mt-2">
        {member && (
            <div className="flex items-center gap-2.5">
                <svg className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="truncate">{member.email}</span>
              </div>
            )}
            
            {therapist && (
              <>
                <div className="flex items-center gap-2.5">
                  <svg className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                  <span className="truncate">
                    {therapist.registrationNo ? `Reg. ${therapist.registrationNo}` : 'No registration no.'}
                  </span>
                </div>
                
                {scheduleDesc && (
                  <div className="flex items-center gap-2.5" title={scheduleDesc.headline}>
                    <svg className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="truncate">{scheduleDesc.summary}</span>
                  </div>
                )}
              </>
            )}
        </div>
        
        <div className="flex-1" />

        {isLastAdmin && (
          <p className="text-[11px] text-[var(--muted)]">Last admin — can't be revoked or demoted.</p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-3 mt-1 border-t border-[var(--border)]">
          <button
            type="button"
            className="text-xs font-medium text-[var(--teal)] hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              setNameDraft(displayName);
              setRoleDraft(role);
              setRegDraft(therapist?.registrationNo ?? '');
              setPhoneDraft(therapist?.phone ?? '');
              setColorDraft(therapist?.color ?? '');
              setBookableDraft(therapist ? therapist.active !== false : role !== 'front_desk');
              setPublicBookableDraft(therapist ? therapist.publicBookable !== false : true);
              setEditing(true);
            }}
          >
            Edit
          </button>
          
          {therapist && role !== 'front_desk' && (
            <button
              type="button"
              className="text-xs font-medium text-[var(--teal)] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                setShowHoursFlow(true);
              }}
            >
              Set working hours
            </button>
          )}
          
          {member && member.status !== 'active' && (
            <button
              type="button"
              disabled={resending}
              className="text-xs font-medium text-[var(--teal)] hover:underline"
              onClick={(e) => { e.stopPropagation(); onResend(); }}
            >
              {resending ? 'Sending…' : 'Resend invite'}
            </button>
          )}

          <div className="ml-auto flex flex-wrap gap-3 items-center justify-end">
            {therapist && (
              <button
                type="button"
                className={`text-xs font-medium hover:underline ${therapist.active !== false ? 'text-[var(--rust)]' : 'text-[var(--teal)]'}`}
                onClick={(e) => { e.stopPropagation(); onDeactivate(); }}
              >
                {therapist.active !== false ? 'Deactivate' : 'Reactivate'}
              </button>
            )}
            
            {member && (
              <button
                type="button"
                className={`text-xs font-medium hover:underline ${isLastAdmin ? 'text-[var(--muted)] opacity-70' : 'text-[var(--rust)]'}`}
                disabled={revoking}
                onClick={(e) => { 
                  e.stopPropagation(); 
                  if (isLastAdmin) {
                    notify.error('This clinic must keep at least one admin — make someone else admin first to unlock this button.');
                    return;
                  }
                  onRevoke(); 
                }}
              >
                {revoking ? 'Revoking…' : 'Revoke access'}
              </button>
            )}
            
            {isUnlinkedTherapist && (
              <button
                type="button"
                className="text-xs font-medium text-[var(--rust)] hover:underline"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
              >
                Delete record
              </button>
            )}
          </div>
        </div>

        {/* Modal Portal */}
        {editing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 p-4 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Edit team member"
              className="dialog-panel relative flex w-full max-w-[500px] flex-col rounded-2xl bg-[var(--surface)] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Scrolling body; the Save/Cancel footer below stays pinned so a
                  short phone screen can always reach it. */}
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 sm:flex-row sm:gap-6 sm:p-6">
              {/* Left Column: Avatar & Quick Info — a compact row on phones */}
              <div className="flex items-center gap-3 sm:w-1/3 sm:flex-col sm:gap-2 sm:border-r sm:border-[var(--border)] sm:pr-4 sm:text-center">
                {renderPhoto('h-14 w-14 shrink-0 sm:mb-2 sm:h-24 sm:w-24')}
                <div className="min-w-0 sm:w-full">
                  <div className="break-words font-semibold leading-tight text-[var(--ink)] sm:px-2">
                    {nameDraft || 'New Member'}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {roleDraft !== 'unknown' ? CLINIC_ROLE_LABELS[roleDraft] : 'Therapist'}
                  </div>
                </div>
              </div>

              {/* Right Column: Form Fields */}
              <div className="flex-1 flex flex-col gap-4">
                <Field label={
                  <>
                    Name
                    <InfoTip text="This clinic-wide name is printed on invoices and shown on schedules. The therapist's personal profile name is separate and only visible to them." />
                  </>
                }>
                  <input
                    className={inputCls}
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    autoFocus
                  />
                </Field>
                
                {(member || (!member && therapist)) && (
                  <Field label="Role">
                    <select
                      className={inputCls}
                      value={roleDraft}
                      onChange={(e) => setRoleDraft(e.target.value as Exclude<ClinicRole, 'unknown'>)}
                    >
                      <option value="therapist">Therapist</option>
                      <option value="front_desk">Front desk</option>
                      <option value="admin">Admin</option>
                    </select>
                  </Field>
                )}

                {!member && therapist && (
                  <Field label="Email address (Link to login)">
                    <input
                      type="email"
                      className={inputCls}
                      placeholder="Optional"
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                    />
                  </Field>
                )}

                {roleDraft !== 'front_desk' && (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--paper)]/60 p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="pr-2">
                        <label htmlFor="member-bookable-toggle" className="text-xs font-semibold text-[var(--ink)] cursor-pointer">
                          Bookable in schedule
                        </label>
                        <p className="text-[11px] text-[var(--muted)] leading-tight">
                          Appears in schedule, appointments, visits and team filters.
                        </p>
                      </div>
                      <input
                        id="member-bookable-toggle"
                        type="checkbox"
                        checked={bookableDraft}
                        onChange={(e) => setBookableDraft(e.target.checked)}
                        className="h-4 w-4 rounded accent-[var(--teal)] cursor-pointer"
                      />
                    </div>
                  </div>
                )}

                {bookableDraft && roleDraft !== 'front_desk' && (
                  <>
                    <Field label="Registration no.">
                      <input
                        className={inputCls}
                        placeholder="Printed on invoices"
                        value={regDraft}
                        onChange={(e) => setRegDraft(e.target.value)}
                      />
                    </Field>
                    <Field label="Phone" htmlFor="therapist-edit-phone">
                      <PhoneField id="therapist-edit-phone" placeholder="WhatsApp number" value={phoneDraft} onChange={setPhoneDraft} />
                    </Field>
                    <div>
                      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Schedule color</span>
                      <TherapistColorPicker
                        value={colorDraft || therapistColor(therapist?.id ?? 'new', therapist?.color)}
                        onChange={setColorDraft}
                        takenBy={colorsTakenByOthers}
                        name={nameDraft || displayName}
                      />
                      <button
                        type="button"
                        className="mt-1 min-h-11 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
                        onClick={() => setColorDraft('')}
                      >
                        Reset to default
                      </button>
                    </div>

                    <div className="rounded-xl border border-[var(--border)] bg-[var(--paper)]/60 p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="pr-2">
                          <label htmlFor="public-bookable-toggle" className="text-xs font-semibold text-[var(--ink)] cursor-pointer">
                            Show in online booking
                          </label>
                          <p className="text-[11px] text-[var(--muted)] leading-tight">
                            Lets patients pick this therapist on your public booking page.
                          </p>
                        </div>
                        <input
                          id="public-bookable-toggle"
                          type="checkbox"
                          checked={publicBookableDraft}
                          onChange={(e) => setPublicBookableDraft(e.target.checked)}
                          className="h-4 w-4 rounded accent-[var(--teal)] cursor-pointer"
                        />
                      </div>
                      {!publicBookableDraft && (
                        <p className="text-[11px] text-[var(--muted)]">
                          Hidden from patients only. They stay on your team, in the schedule, and in shift planning — front desk can still book them.
                        </p>
                      )}
                    </div>
                  </>
                )}
                
                <ErrorNote message={error} />
              </div>
              </div>

              <div className="flex shrink-0 justify-end gap-3 border-t border-[var(--border)] px-5 py-3 sm:px-6 sm:py-4">
                <button
                  type="button"
                  className="px-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--teal)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--teal-strong)] disabled:opacity-50"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showHoursFlow && therapist && roleDraft !== 'front_desk' && (
          <SetWorkingHoursFlow
            open={showHoursFlow}
            therapist={therapist}
            onClose={() => setShowHoursFlow(false)}
            onSaved={() => onSaved()}
          />
        )}

    </div>
  );
}

/** Two therapists showing in one color are hard to tell apart on the schedule: say so and fix it in one tap. */
function ColorClashNotice({ therapists }: { therapists: Therapist[] }) {
  const clashes = useMemo(() => colorClashes(therapists), [therapists]);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (clashes.length === 0) return null;

  async function giveNewColor(target: Therapist) {
    setBusyId(target.id);
    try {
      const others = therapists.filter((t) => t.id !== target.id && t.active !== false);
      await repos.therapists.put({
        ...target,
        color: nextUnusedColor(others.map((t) => therapistColor(t.id, t.color))),
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div role="status" className="mb-4 space-y-2 rounded-xl border border-[var(--amber)]/40 bg-[var(--amber-light)] px-3 py-2.5 text-sm text-[var(--ink)]" data-color-clash>
      {clashes.map((clash) => {
        const [, ...rest] = clash.therapists;
        return (
          <div key={clash.color} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: clash.color }} />
            <span className="min-w-0 flex-1">
              {clash.therapists.map((t) => t.name).join(' and ')} share one color on the schedule.
            </span>
            {rest.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={busyId === t.id}
                className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)] disabled:opacity-50"
                onClick={() => void giveNewColor(t)}
              >
                Give {t.name.split(/\s+/)[0]} a new color
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AddTeamMemberForm({
  clinicId,
  onAdded,
  loginsLocked = false,
}: {
  clinicId: string;
  onAdded: () => void;
  /** The plan's login seats are used up: only roster (no-login) therapists can still be added. */
  loginsLocked?: boolean;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<ClinicRole, 'unknown'>>('therapist');
  const [needsLogin, setNeedsLogin] = useState(!loginsLocked);
  const [bookable, setBookable] = useState(true);
  
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-toggle bookable based on role
  useEffect(() => {
    if (role === 'therapist') {
      setBookable(true);
    } else {
      setBookable(false);
    }
  }, [role]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Name is required');
    if (needsLogin && !email.trim()) return setError('Email is required for login');
    const effectiveBookable = role === 'front_desk' ? false : bookable;
    if (!needsLogin && !effectiveBookable) return setError('Must either need a login or be bookable');

    setBusy(true);
    setError(null);
    try {
      if (needsLogin) {
        const supabase = getSupabase();
        if (!supabase) throw new Error('No Supabase connection');
        const { data: result, error: invokeError } = await supabase.functions.invoke(
          'invite-therapist',
          {
            body: {
              action: 'invite',
              clinicId,
              email: email.trim(),
              name: name.trim(),
              role,
              bookable: effectiveBookable,
              redirectOrigin: window.location.origin,
            },
          }
        );
        if (invokeError) throw new Error(await edgeFunctionErrorMessage(invokeError));
        const payload = result as { error?: string; success?: boolean } | null;
        if (payload?.error) throw new Error(payload.error);
      } else if (effectiveBookable) {
        // Just a roster entry
        const existing = await repos.therapists.list(clinicId, true);
        await repos.therapists.put({
          id: crypto.randomUUID(),
          clinicId,
          name: name.trim(),
          active: true,
          userId: null,
          // A new therapist starts with a color nobody else uses.
          color: nextUnusedColor(existing.filter((t) => t.active !== false).map((t) => therapistColor(t.id, t.color))),
          updatedAt: new Date().toISOString(),
        });
      }

      setName('');
      setEmail('');
      setRole('therapist');
      setNeedsLogin(!loginsLocked);
      onAdded();
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <h4 className="font-semibold text-sm text-[var(--ink)]">Add team member</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name">
          <input
            className={inputCls}
            placeholder="Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {needsLogin && (
          <Field label="Email">
            <input
              type="email"
              className={inputCls}
              placeholder="jane@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        )}
        {needsLogin && (
          <Field label="Role">
            <select
              className={inputCls}
              value={role}
              onChange={(e) => setRole(e.target.value as Exclude<ClinicRole, 'unknown'>)}
            >
              <option value="therapist">Therapist</option>
              <option value="front_desk">Front desk</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
        )}
      </div>
      
      <div className="flex flex-col gap-2 mt-1 border-t border-[var(--border)] pt-3">
        <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
          <input
            type="checkbox"
            checked={needsLogin}
            disabled={loginsLocked}
            onChange={(e) => setNeedsLogin(e.target.checked)}
          />
          Needs login (can sign in to Theranet)
        </label>
        {loginsLocked && (
          <p className="-mt-1 ml-6 text-xs text-[var(--muted)]">
            Team logins are included in {PLAN_TIER_LABELS[minimumTierFor('team')]} and above. You can still add a therapist to the schedule without a login.
          </p>
        )}
        {role !== 'front_desk' && (
          <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
            <input
              type="checkbox"
              checked={bookable}
              onChange={(e) => setBookable(e.target.checked)}
            />
            Bookable (appears in schedule and invoices)
          </label>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="submit"
          className={btnPrimary}
          disabled={busy || (!needsLogin && (role === 'front_desk' || !bookable))}
        >
          {busy ? 'Adding…' : 'Add member'}
        </button>
      </div>
      <ErrorNote message={error} />
    </form>
  );
}

export function Therapists() {
  const clinic = useClinic();
  const entitlements = useEntitlements(clinic.id);
  const rawTherapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinic.id, true), [clinic.id]);
  const assignments = useLiveQuery(
    () => repos.therapistShiftAssignments.listByClinic(clinic.id),
    [clinic.id]
  );
  const [members, setMembers] = useState<ClinicMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [revokeInProgress, setRevokeInProgress] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ userId: string; email: string } | null>(null);
  const [resendInProgress, setResendInProgress] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Therapist | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<{ therapist: Therapist; upcoming: number } | null>(null);
  
  // Filter states
  const [filter, setFilter] = useState<'all' | 'bookable' | 'staff' | 'invited' | 'inactive' | 'unlinked'>('all');

  const refetchMembers = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data, error } = await supabase.rpc('list_clinic_members_with_email', {
      p_clinic_id: clinic.id,
    });
    if (error) {
      setMembersError(toFriendlyMessage(new Error(error.message)));
      return;
    }
    setMembers(
      (
        data as {
          user_id: string;
          email: string;
          role: string;
          display_name: string | null;
          invited_at: string | null;
          last_sign_in_at: string | null;
          require_password_setup: boolean | null;
          last_active_at: string | null;
        }[]
      ).map((m) => ({
        userId: m.user_id,
        email: m.email,
        role: m.role,
        displayName: m.display_name,
        status: memberOnboardingStatus({
          lastSignInAt: m.last_sign_in_at,
          requirePasswordSetup: m.require_password_setup === true,
        }),
        invitedAt: m.invited_at,
        lastSignInAt: m.last_sign_in_at,
        lastActiveAt: m.last_active_at,
      }))
    );
  }, [clinic.id]);

  useEffect(() => {
    void refetchMembers();
  }, [refetchMembers]);

  const teamList = useMemo(
    () => buildTeamList(members, rawTherapists ?? null),
    [members, rawTherapists]
  );
  
  const filteredTeam = useMemo(() => {
    return teamList.filter(p => {
      if (filter === 'inactive') return p.therapist?.active === false;
      
      // Hide inactive therapists from all other views
      if (p.therapist && p.therapist.active === false) return false;

      if (filter === 'bookable') return !!p.therapist;
      if (filter === 'staff') return p.member && !p.therapist;
      if (filter === 'invited') return p.member?.status !== 'active';
      if (filter === 'unlinked') return p.therapist && !p.member;
      return true;
    });
  }, [teamList, filter]);

  const unlinkedCount = teamList.filter(p => p.therapist && p.therapist.active !== false && !p.member).length;

  const atSeatCap =
    entitlements.enforcementEnabled &&
    !entitlements.loading &&
    members !== null &&
    members.length >= entitlements.maxMembers;

  async function startDeleteTherapist(t: Therapist) {
    setRosterError(null);
    try {
      const linked = await countTherapistLinkedRecords(repos, clinic.id, t.id);
      if (linked > 0) {
        setRosterError(
          `${t.name} has ${linked} linked record(s) (visits, notes, or invoices), so they can't be permanently deleted — deactivate instead.`
        );
        return;
      }
      setDeleteTarget(t);
    } catch (e) {
      setRosterError(toFriendlyMessage(e));
    }
  }

  async function confirmDeleteTherapist() {
    if (!deleteTarget) return;
    setRosterError(null);
    try {
      await therapistService.hardDelete(deleteTarget.id);
      setDeleteTarget(null);
    } catch (e) {
      setRosterError(toFriendlyMessage(e));
    }
  }

  async function requestToggleActive(t: Therapist) {
    if (t.active === false) {
      await handleToggleActive(t);
      return;
    }
    setRosterError(null);
    try {
      const now = Date.now();
      const rows = await repos.appointments.listByClinic(clinic.id);
      const upcoming = rows.filter(
        (a) =>
          a.therapistId === t.id &&
          a.status !== 'cancelled' &&
          a.status !== 'no_show' &&
          new Date(a.scheduledAt).getTime() >= now
      ).length;
      setDeactivateTarget({ therapist: t, upcoming });
    } catch (e) {
      setRosterError(toFriendlyMessage(e));
    }
  }

  async function handleToggleActive(t: Therapist) {
    setRosterError(null);
    try {
      await repos.therapists.put({
        ...t,
        active: !t.active,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      setRosterError(toFriendlyMessage(e));
    }
  }

  async function uploadPhoto(t: Therapist, file: File) {
    setRosterError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setRosterError('Photo upload needs a connection.');
      return;
    }
    try {
      const resized = await resizeImageToBlob(file, 256);
      const path = `${clinic.id}/therapist-${t.id}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('clinic-assets')
        .upload(path, resized, { contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      await repos.therapists.put({ ...t, photoPath: path, updatedAt: new Date().toISOString() });
    } catch (e) {
      setRosterError(toFriendlyMessage(e));
    }
  }

  function revokeMember(userId: string, email: string) {
    const target = members?.find((m) => m.userId === userId);
    const isLastAdmin =
      target?.role === 'admin' && (members?.filter((m) => m.role === 'admin').length ?? 0) <= 1;
    if (isLastAdmin) {
      setMembersError(
        'This clinic must keep at least one admin — revoke or demote another admin first.'
      );
      return;
    }
    setRevokeTarget({ userId, email });
  }

  async function confirmRevokeMember() {
    if (!revokeTarget) return;
    const { userId } = revokeTarget;
    setRevokeTarget(null);
    setMembersError(null);
    setRevokeInProgress(userId);
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error('No Supabase connection');

      const { error } = await supabase
        .from('clinic_members')
        .delete()
        .eq('clinic_id', clinic.id)
        .eq('user_id', userId);

      if (error) throw error;

      const linked = (rawTherapists ?? []).filter((t) => t.userId === userId);
      for (const t of linked) {
        await repos.therapists.put({
          ...t,
          userId: null,
          updatedAt: new Date().toISOString(),
        });
      }

      setMembers((prev) => prev?.filter((m) => m.userId !== userId) ?? null);
    } catch (e) {
      setMembersError(toFriendlyMessage(e));
    } finally {
      setRevokeInProgress(null);
    }
  }

  async function resendInvite(userId: string) {
    setMembersError(null);
    setResendInProgress(userId);
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error('No Supabase connection');
      const { data: result, error: invokeError } = await supabase.functions.invoke(
        'invite-therapist',
        {
          body: {
            action: 'resend',
            clinicId: clinic.id,
            userId,
            redirectOrigin: window.location.origin,
          },
        }
      );
      if (invokeError) throw new Error(await edgeFunctionErrorMessage(invokeError));
      const payload = result as { error?: string; message?: string } | null;
      if (payload?.error) throw new Error(payload.error);
    } catch (e) {
      setMembersError(toFriendlyMessage(e));
    } finally {
      setResendInProgress(null);
    }
  }

  return (
    <SectionCard id="settings-card-team-therapists" title="Team Directory">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div className="flex flex-wrap gap-2">
          {(['all', 'bookable', 'staff', 'invited', 'inactive', 'unlinked'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="rounded-full border px-3 py-1 text-xs font-semibold capitalize"
              style={{
                borderColor: filter === f ? 'var(--teal)' : 'var(--border)',
                background: filter === f ? 'var(--teal-light)' : 'var(--surface)',
                color: filter === f ? 'var(--teal)' : 'var(--muted)',
              }}
            >
              {f}
              {f === 'unlinked' && unlinkedCount > 0 && (
                <span className="ml-1.5 rounded-full bg-[var(--rust)] px-1.5 py-0.5 text-[10px] text-white">
                  {unlinkedCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--muted)]">
          {filteredTeam.length} member{filteredTeam.length === 1 ? '' : 's'}
        </p>
      </div>

      <ColorClashNotice therapists={rawTherapists ?? []} />

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 mb-6 items-start">
        {filteredTeam.map((p) => {
          const isLastAdmin =
            p.member?.role === 'admin' &&
            (members?.filter((x) => x.role === 'admin').length ?? 0) <= 1;
          const therapistAssignments = (assignments ?? []).filter(
            (a) => a.therapistId === p.therapist?.id
          );

          return (
            <TeamMemberCard
              key={p.key}
              person={p}
              clinicId={clinic.id}
              isLastAdmin={isLastAdmin}
              revoking={revokeInProgress === p.member?.userId}
              resending={resendInProgress === p.member?.userId}
              onRevoke={() => {
                if (p.member) revokeMember(p.member.userId, p.member.email);
              }}
              onResend={() => {
                if (p.member) void resendInvite(p.member.userId);
              }}
              onSaved={() => void refetchMembers()}
              onDelete={() => {
                if (p.therapist) void startDeleteTherapist(p.therapist);
              }}
              onPhotoUpload={(file) => {
                if (p.therapist) void uploadPhoto(p.therapist, file);
              }}
              onDeactivate={() => {
                if (p.therapist) void requestToggleActive(p.therapist);
              }}
              assignments={therapistAssignments}
              templates={templates ?? []}
              clinic={clinic}
            />
          );
        })}
      </div>

      {filteredTeam.length === 0 && (
        <p className="mb-6 text-sm text-[var(--muted)]">No team members found for this filter.</p>
      )}

      <ErrorNote message={membersError || rosterError} />

      <div className="border-t border-[var(--border)] pt-6">
        <div className="max-w-xl">
          <AddTeamMemberForm
            key={atSeatCap ? 'roster-only' : 'full'}
            clinicId={clinic.id}
            loginsLocked={Boolean(atSeatCap)}
            onAdded={() => void refetchMembers()}
          />
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          open={true}
          title="Delete service roster record"
          message={`Are you sure you want to delete ${deleteTarget.name} from the service roster? This cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Keep record"
          destructive
          onConfirm={() => void confirmDeleteTherapist()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      
      {deactivateTarget && (
        <ConfirmDialog
          open={true}
          title="Deactivate therapist"
          message={`${deactivateTarget.therapist.name} will no longer be bookable or shown in schedule filters. Past records stay intact; you can reactivate anytime.${
            deactivateTarget.upcoming > 0
              ? ` They still have ${deactivateTarget.upcoming} upcoming appointment(s) — reassign or cancel those separately.`
              : ''
          }`}
          confirmLabel="Deactivate"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => {
            const t = deactivateTarget.therapist;
            setDeactivateTarget(null);
            void handleToggleActive(t);
          }}
          onCancel={() => setDeactivateTarget(null)}
        />
      )}

      {revokeTarget && (
        <ConfirmDialog
          open={true}
          title="Revoke login access"
          message={`Revoke ${revokeTarget.email}'s access to this clinic?`}
          confirmLabel="Revoke"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => void confirmRevokeMember()}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </SectionCard>
  );
}
