import { Suspense, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ALL_SYNCED_TABLES } from '@/lib/db';
import { getSupabase, publicLogoUrl } from '@/lib/supabase';
import { syncEngine } from '@/sync/engine';
import { useSession } from './useSession';
import { useClinicRole, CLINIC_ROLE_LABELS, type ClinicRole } from './useClinicRole';
import { ClinicContext } from './clinicContext';
import { LoginPage } from '@/features/auth/LoginPage';
import { CreateClinicForm } from '@/features/setup/CreateClinicForm';
import { SyncBadge } from '@/components/SyncBadge';

/** Minimal stroke icons, one per main nav item — same visual language as
 *  the existing hamburger/close glyphs (currentColor, ~1.6px stroke,
 *  round caps, no fill). */
function IconWorkspace({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M3.5 9.5L10 4l6.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 8.5V15a1 1 0 001 1h3v-4.5h1V16h3a1 1 0 001-1V8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconLedger({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="4.5" y="3" width="11" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 7.2h6M7 10h6M7 12.8h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function IconPatients({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="7.3" cy="6.3" r="2.3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="13.2" cy="7" r="1.9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.5 16c.5-3 2.5-4.7 4.8-4.7s4.3 1.7 4.8 4.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12.3 11.6c1.9.2 3.4 1.7 3.8 4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function IconReports({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M4 16.5V11M10 16.5V4M16 16.5V8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3 16.5h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function IconSettings({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M4 5.5h7.5M4 10h11M4 14.5h7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="14" cy="5.5" r="1.7" fill="var(--surface)" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8.5" cy="14.5" r="1.7" fill="var(--surface)" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

const NAV = [
  { to: '/workspace', label: 'Workspace', Icon: IconWorkspace },
  { to: '/ledger', label: 'Ledger', Icon: IconLedger },
  { to: '/patients', label: 'Patients', Icon: IconPatients },
  { to: '/insights', label: 'Reports', Icon: IconReports },
  { to: '/settings', label: 'Settings', Icon: IconSettings },
] as const;

export function Shell() {
  const { loading, session } = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [syncKicked, setSyncKicked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const clinics = useLiveQuery(() => db.clinics.toArray(), []);
  const activeClinicId = useLiveQuery(
    async () => (await db.meta.get('activeClinicId'))?.value ?? null,
    []
  );
  const clinic =
    clinics?.find((c) => c.id === activeClinicId) ?? (clinics?.length === 1 ? clinics[0] : null);
  const logoUrl = useMemo(() => publicLogoUrl(clinic?.logoPath), [clinic?.logoPath]);
  // Can't use usePermissions()/useWorkspaceScope() here — both need
  // ClinicContext, and this component is the one that provides it further
  // down. useClinicRole takes a clinicId directly instead. Nav filtering
  // (not RLS) is display-only, same caveat as everywhere else this role
  // value is read; the real boundary is the settings tables' RLS policies.
  const { role, displayName, setDisplayName } = useClinicRole(clinic?.id ?? '');
  // Local-part of the email, not the full address — the account area used
  // to show the raw email everywhere; this is the fallback for anyone who
  // hasn't set a display name yet, not a full replacement for a real name.
  const fallbackName = session?.user?.email?.split('@')[0] ?? 'Account';
  // Reports (Dashboard + monthly statement) is admin/front_desk only —
  // aggregates stay off-limits to a plain therapist (decision 3), same
  // conservative default as Settings: hidden during 'unknown' role
  // resolution too, not just for a confirmed therapist, so the item never
  // flashes visible before role settles.
  const nav = useMemo(
    () =>
      NAV.filter(
        (item) =>
          (item.to !== '/settings' || role === 'admin') &&
          (item.to !== '/insights' || role === 'admin' || role === 'front_desk')
      ),
    [role]
  );

  useEffect(() => {
    if (session) {
      syncEngine.start();
      syncEngine.schedule(0);
      setSyncKicked(true);
    } else {
      // Clear local Dexie data when user signs out to prevent leaking
      // cached data from one account to another. Iterates every synced
      // table (ALL_SYNCED_TABLES) rather than a hand-picked list, so a new
      // table can't be added to the sync engine without also being cleared
      // here — this list previously omitted consultation_notes,
      // patient_module_enrollments, and expected_visits, leaving clinical
      // notes readable in IndexedDB on a shared device after sign-out.
      for (const table of ALL_SYNCED_TABLES) void db.table(table).clear();
      void db.outbox.clear();
      void db.meta.clear();
    }
  }, [session]);

  // Default the active clinic to the first membership once data arrives
  useEffect(() => {
    if (clinics?.length && activeClinicId === null) {
      void db.meta.put({ key: 'activeClinicId', value: clinics[0].id });
    }
  }, [clinics, activeClinicId]);

  // The recovery link's own auth flow doesn't need session/clinic gating —
  // it may be opened by someone whose local session has expired, and it
  // must render before those checks would otherwise redirect to login.
  if (pathname === '/reset-password') {
    return (
      <Suspense fallback={<Centered>Loading…</Centered>}>
        <Outlet />
      </Suspense>
    );
  }

  if (loading) return <Centered>Loading…</Centered>;
  if (!session) return <LoginPage />;

  if (!clinic) {
    // `clinics`/`activeClinicId` are undefined until Dexie's own async
    // queries resolve — that's indistinguishable from `clinic === null`
    // below, so without this check, a hard refresh (where the session
    // resolves from localStorage faster than Dexie opens IndexedDB) briefly
    // renders CreateClinicForm before the real clinic loads in, since
    // `syncKicked` only tracks whether the session is ready, not Dexie.
    if (!syncKicked || clinics === undefined || activeClinicId === undefined) {
      return (
        <Centered>
          <div className="text-center text-sm text-[var(--muted)]">Preparing…</div>
        </Centered>
      );
    }

    // Confirmed zero clinics for this account — show clinic creation form
    return (
      <CreateClinicForm
        onSuccess={() => {
          // Force sync to pull the new clinic data
          void syncEngine.schedule(0);
        }}
      />
    );
  }

  // Print views render without app chrome
  if (pathname.endsWith('/print')) {
    return (
      <ClinicContext.Provider value={clinic}>
        <Suspense fallback={<Centered>Loading…</Centered>}>
          <Outlet />
        </Suspense>
      </ClinicContext.Provider>
    );
  }

  return (
    <ClinicContext.Provider value={clinic}>
      <div className="min-h-screen bg-[var(--paper)]">
        <header className="no-print sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)]">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              {logoUrl && <img src={logoUrl} alt="" className="h-8 w-auto shrink-0 object-contain" />}
              <div className="font-display truncate text-lg font-semibold text-[var(--ink)]">{clinic.name}</div>
            </div>
            {/* Desktop nav — the same items reappear as the bottom tab bar
                below sm:, so this one only needs to render at sm: and up. */}
            <nav className="hidden gap-1 sm:flex">
              {nav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--paper)] [&.active]:bg-[var(--teal-light)] [&.active]:font-medium [&.active]:text-[var(--teal)]"
                >
                  <item.Icon className="shrink-0" />
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-4">
              <SyncBadge />
              <div className="hidden flex-col items-end gap-1 sm:flex">
                <NameEditor
                  variant="desktop"
                  displayName={displayName}
                  fallbackName={fallbackName}
                  role={role}
                  setDisplayName={setDisplayName}
                />
                <button
                  className="text-xs text-[var(--muted)] hover:text-[var(--ink)]"
                  onClick={() => getSupabase()?.auth.signOut()}
                >
                  Sign out
                </button>
              </div>
              {/* Mobile account menu — navigation itself lives in the
                  bottom tab bar now, so this toggle is scoped to just the
                  account (who's signed in, their name/role, sign out), not
                  the full nav. */}
              <div className="relative sm:hidden">
                <button
                  className="rounded-full p-1.5 text-[var(--muted)] hover:bg-[var(--paper)]"
                  aria-label="Account"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <circle cx="10" cy="7" r="2.6" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M3.5 16c.7-3.4 3-5.2 6.5-5.2s5.8 1.8 6.5 5.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
                      <NameEditor
                        variant="mobile"
                        displayName={displayName}
                        fallbackName={fallbackName}
                        role={role}
                        setDisplayName={setDisplayName}
                      />
                      <button
                        className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-[var(--muted)] hover:bg-[var(--paper)]"
                        onClick={() => getSupabase()?.auth.signOut()}
                      >
                        Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:pb-6">
          <Suspense fallback={<div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div>}>
            <Outlet />
          </Suspense>
        </main>
        {/* Bottom tab bar — primary navigation on mobile. Fixed, not
            sticky, so it stays reachable regardless of scroll position,
            the same way a native app's tab bar would; main gets matching
            bottom padding (pb-24 above) so the last bit of every page's
            content doesn't sit underneath it. Doesn't intercept touch
            events outside its own bar, so the browser's native
            back-swipe/back-button gesture is untouched. */}
        <nav className="no-print fixed inset-x-0 bottom-0 z-10 flex border-t border-[var(--border)] bg-[var(--surface)] sm:hidden">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-[var(--muted)] [&.active]:text-[var(--teal)]"
            >
              <item.Icon />
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </ClinicContext.Provider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center">{children}</div>;
}

/**
 * Shows the signed-in member's own display name + role instead of raw
 * email, with a click-to-edit affordance so anyone (not just an admin) can
 * set or change their own name — an invited member picks their own on
 * first login rather than being stuck with whatever an admin typed at
 * invite time. Rendered twice (desktop header, mobile dropdown); each
 * instance owns its own editing state independently, which is fine since
 * only one is ever visible at a time (the other is `hidden`/`sm:hidden`).
 */
function NameEditor({
  variant,
  displayName,
  fallbackName,
  role,
  setDisplayName,
}: {
  variant: 'desktop' | 'mobile';
  displayName: string | null;
  fallbackName: string;
  role: ClinicRole;
  setDisplayName: (name: string) => Promise<void>;
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
          <button type="button" className="text-xs font-medium text-[var(--teal)] disabled:opacity-50" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="text-xs text-[var(--muted)]" onClick={() => setEditing(false)}>
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
      {roleLabel && (
        <div className={variant === 'desktop' ? 'text-[10px] uppercase tracking-wide text-[var(--muted)]' : 'text-xs text-[var(--muted)]'}>
          {roleLabel}
        </div>
      )}
    </div>
  );
}
