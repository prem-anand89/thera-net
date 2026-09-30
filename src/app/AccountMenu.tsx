import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { signOutSafely } from './signOut';
import { CLINIC_ROLE_LABELS, type ClinicRole } from './useClinicRole';
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog';
import { HelpFeedbackDialog } from '@/components/HelpFeedbackDialog';
import { IconSettings } from '@/components/NavIcons';
import { useFirstWeekChecklistSummary } from '@/features/settings/FirstWeekChecklist';
import { BrandMark } from '@/components/BrandMark';

/** First letters of up to two name words, skipping a leading honorific —
 *  "Dr. Prem Anand" -> "PA", "Ritu" -> "R". Purely decorative (the avatar
 *  circle in the account menu trigger), so a plain '?' fallback for an
 *  empty/unparseable name is fine — nothing downstream depends on it. */
export function initialsFor(name: string): string {
  const words = name
    .replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * The setup-nudge card inside the account menu — a real "continue where you
 * left off" link, not a static `/settings` bounce: `setup.nextStep.link`
 * names the exact first not-done step's own destination (a Settings tab, or
 * `+ New visit` for "log your first visit"), computed by
 * `useFirstWeekChecklistSummary`. Two full `<Link>` branches rather than one
 * with a dynamic `to` — TanStack Router types each route's `search` against
 * that route's own schema, so a `to` that varies at runtime can't carry a
 * correctly-typed `search` alongside it.
 */
function SetupNudgeLink({
  setup,
  onNavigate,
}: {
  setup: NonNullable<ReturnType<typeof useFirstWeekChecklistSummary>>;
  onNavigate: () => void;
}) {
  const className =
    'mb-2 block rounded-md border border-[var(--teal-light)] bg-[var(--teal-light)] p-2 text-xs text-[var(--ink)] hover:opacity-90';
  const content = (
    <>
      <div className="flex items-center justify-between font-medium">
        <span>
          Setup {setup.completedCount} of {setup.totalCount}
        </span>
        <span className="text-[var(--teal)]">Continue →</span>
      </div>
      {setup.nextStep && (
        <p className="mt-0.5 truncate text-[var(--muted)]">{setup.nextStep.title}</p>
      )}
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface)]">
        <div
          className="h-full rounded-full bg-[var(--teal)]"
          style={{
            width: `${Math.round((setup.completedCount / Math.max(1, setup.totalCount)) * 100)}%`,
          }}
        />
      </div>
    </>
  );

  if (setup.nextStep?.link?.kind === 'new-visit') {
    return (
      <Link to="/visits/new" onClick={onNavigate} className={className}>
        {content}
      </Link>
    );
  }
  const tab = setup.nextStep?.link?.kind === 'settings' ? setup.nextStep.link.tab : undefined;
  return (
    <Link
      to="/settings"
      search={tab ? { tab } : undefined}
      onClick={onNavigate}
      className={className}
    >
      {content}
    </Link>
  );
}

/**
 * Shows the signed-in member's own display name + role instead of raw
 * email, with a click-to-edit affordance so anyone (not just an admin) can
 * set or change their own name — an invited member picks their own on
 * first login rather than being stuck with whatever an admin typed at
 * invite time. Rendered inside `AccountMenu`'s dropdown panel.
 */
function NameEditor({
  variant,
  displayName,
  fallbackName,
  role,
  setDisplayName,
  showRole = true,
}: {
  variant: 'desktop' | 'mobile';
  displayName: string | null;
  fallbackName: string;
  role: ClinicRole;
  setDisplayName: (name: string) => Promise<void>;
  showRole?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roleLabel = role !== 'unknown' ? CLINIC_ROLE_LABELS[role] : '';

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await setDisplayName(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className={variant === 'desktop' ? 'flex flex-col items-end gap-1' : 'mb-2 space-y-1.5'}>
        <input
          autoFocus
          className="w-36 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--ink)]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') setEditing(false);
          }}
          placeholder="Your name"
        />
        <div className="flex gap-2">
          <button
            type="button"
            className="text-xs font-medium text-[var(--teal)] disabled:opacity-50"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="text-xs text-[var(--muted)]"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
        {error && <div className="text-[10px] text-[var(--rust)]">{error}</div>}
      </div>
    );
  }

  return (
    <div className={variant === 'desktop' ? 'flex flex-col items-end gap-0.5' : 'mb-2'}>
      <button
        type="button"
        className={
          variant === 'desktop'
            ? 'text-xs font-medium text-[var(--ink)] hover:underline'
            : 'block text-left text-sm font-medium text-[var(--ink)] hover:underline'
        }
        onClick={() => {
          setDraft(displayName ?? '');
          setError(null);
          setEditing(true);
        }}
      >
        {displayName ?? fallbackName}
      </button>
      {showRole && roleLabel && (
        <div
          className={
            variant === 'desktop'
              ? 'text-[10px] uppercase tracking-wide text-[var(--muted)]'
              : 'text-xs text-[var(--muted)]'
          }
        >
          {roleLabel}
        </div>
      )}
    </div>
  );
}

/**
 * The one account-corner menu, same markup at every breakpoint — the name/
 * role label collapses to just the avatar circle below `sm:`, same as the
 * old mobile-only hamburger did, but without maintaining a second, parallel
 * dropdown implementation. Houses: the click-to-edit name/role (via
 * `NameEditor`), a nudge toward the First Week setup checklist for an admin
 * who hasn't finished/dismissed it (`useFirstWeekChecklistSummary` —
 * SettingsPage's own card is the full version of this, this is a one-line
 * "N of M, continue" pointer to it), Settings, Change/Set password (label
 * depends on whether the account has an email/password identity yet), Help,
 * Sign out, and a Thera.Net + version footer. Switching or adding clinics
 * lives in the header's clinic pill (`ClinicSwitcher`), not here.
 */
export function AccountMenu({
  displayName,
  fallbackName,
  role,
  setDisplayName,
  clinicId,
  hasPasswordIdentity,
}: {
  displayName: string | null;
  fallbackName: string;
  role: ClinicRole;
  setDisplayName: (name: string) => Promise<void>;
  clinicId: string;
  /** False for a Google-only account with no email/password identity yet —
   *  relabels the menu item and dialog from "Change" to "Set" so it reads
   *  as the deliberate opt-in it is, not a correction of something broken. */
  hasPasswordIdentity: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const name = displayName ?? fallbackName;
  const roleLabel = role !== 'unknown' ? CLINIC_ROLE_LABELS[role] : '';
  const setup = useFirstWeekChecklistSummary(clinicId);
  const showSetupNudge = role === 'admin' && setup?.visible === true;

  function closeMenu() {
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-full p-0.5 hover:bg-[var(--paper)] sm:rounded-md sm:px-1.5 sm:py-1"
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--teal)] text-xs font-semibold text-white"
        >
          {initialsFor(name)}
        </span>
        {/* Name only — the clinic name used to sit under it here *and* at
            the far left of the header, and the dropdown below names the
            current clinic a third time (with the switcher). One line here
            gives the nav back the ~70px the wrapped pair was holding.
            Hidden through the whole tab: range (not just below sm:) so the
            nav's own labels (tab:-and-up now) have the room — just the
            avatar initials show there, same as on phone. */}
        <span className="hidden max-w-[9rem] truncate text-xs font-medium text-[var(--ink)] desktop:inline">
          {name}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={closeMenu} />
          <div className="absolute right-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg">
            <div className="bg-[var(--paper)] px-3 py-3">
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--teal)] text-sm font-semibold text-white"
                >
                  {initialsFor(name)}
                </span>
                <div className="min-w-0 flex-1">
                  <NameEditor
                    variant="mobile"
                    displayName={displayName}
                    fallbackName={fallbackName}
                    role={role}
                    setDisplayName={setDisplayName}
                    showRole={false}
                  />
                  {roleLabel && (
                    <span className="mt-0.5 inline-block rounded-full bg-[var(--teal-light)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--teal-strong)]">
                      {roleLabel}
                    </span>
                  )}
                </div>
              </div>
              {showSetupNudge && setup && (
                <div className="mt-2.5">
                  <SetupNudgeLink setup={setup} onNavigate={closeMenu} />
                </div>
              )}
            </div>

            <div className="border-t border-[var(--border)] px-2 py-2">
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Account
              </p>
              {role === 'admin' && (
                <Link
                  to="/settings"
                  onClick={closeMenu}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--ink)] hover:bg-[var(--paper)]"
                >
                  <IconSettings className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                  Settings
                </Link>
              )}
              <button
                type="button"
                className="flex w-full rounded-lg px-2.5 py-2 text-left text-sm text-[var(--ink)] hover:bg-[var(--paper)]"
                onClick={() => {
                  closeMenu();
                  setChangingPassword(true);
                }}
              >
                {hasPasswordIdentity ? 'Change password' : 'Set a password'}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--ink)] hover:bg-[var(--paper)]"
                onClick={() => {
                  closeMenu();
                  setHelpOpen(true);
                }}
              >
                <svg className="h-4 w-4 shrink-0 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                Help & Feedback
              </button>
            </div>

            <div className="border-t border-[var(--border)] bg-[var(--paper)] px-2 py-2">
              <button
                type="button"
                className="flex w-full rounded-lg px-2.5 py-2 text-left text-sm font-medium text-[var(--rust)] hover:bg-[var(--rust-light)]"
                onClick={() => void signOutSafely()}
              >
                Sign out
              </button>
            </div>
            <div className="flex items-center justify-center gap-1.5 border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]">
              <BrandMark size={14} decorative />
              <span>Thera.Net · v{__APP_VERSION__}</span>
            </div>
          </div>
        </>
      )}

      {changingPassword && (
        <ChangePasswordDialog
          isFirstPassword={!hasPasswordIdentity}
          onClose={() => setChangingPassword(false)}
        />
      )}
      <HelpFeedbackDialog
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  );
}
