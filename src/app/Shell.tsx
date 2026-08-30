import {
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ALL_SYNCED_TABLES } from '@/lib/db';
import { getSupabase, publicLogoUrl } from '@/lib/supabase';
import { syncEngine } from '@/sync/engine';
import { syncStatus } from '@/sync/status';
import { useSession } from './useSession';
import { useClinicRole, CLINIC_ROLE_LABELS, type ClinicRole } from './useClinicRole';
import { ClinicContext } from './clinicContext';
import { LoginPage } from '@/features/auth/LoginPage';
import { CreateClinicForm } from '@/features/settings/CreateClinicForm';
import { SyncBadge, SyncStatusBanners } from '@/components/SyncBadge';
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog';
import { AddClinicDialog } from '@/components/AddClinicDialog';
import type { Clinic } from '@/domain/types';
import { useFirstWeekChecklistSummary } from '@/features/settings/FirstWeekChecklist';

/** Minimal stroke icons, one per main nav item — same visual language as
 *  the existing hamburger/close glyphs (currentColor, ~1.6px stroke,
 *  round caps, no fill). */
function IconWorkspace({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3.5 9.5L10 4l6.5 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 8.5V15a1 1 0 001 1h3v-4.5h1V16h3a1 1 0 001-1V8.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconLedger({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="4.5" y="3" width="11" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M7 7.2h6M7 10h6M7 12.8h3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconPatients({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="7.3" cy="6.3" r="2.3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="13.2" cy="7" r="1.9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M2.5 16c.5-3 2.5-4.7 4.8-4.7s4.3 1.7 4.8 4.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M12.3 11.6c1.9.2 3.4 1.7 3.8 4.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconReports({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M4 16.5V11M10 16.5V4M16 16.5V8.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M3 16.5h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function IconSettings({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M4 5.5h7.5M4 10h11M4 14.5h7.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle
        cx="14"
        cy="5.5"
        r="1.7"
        fill="var(--surface)"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle
        cx="8.5"
        cy="14.5"
        r="1.7"
        fill="var(--surface)"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}
function IconRequests({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3 5.5h14v9a1 1 0 01-1 1H4a1 1 0 01-1-1v-9zM3 5.5l3.5 4.2h7L17 5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconMore({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="5" cy="10" r="1.4" fill="currentColor" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" />
      <circle cx="15" cy="10" r="1.4" fill="currentColor" />
    </svg>
  );
}

const NAV = [
  { to: '/workspace', label: 'Workspace', Icon: IconWorkspace },
  { to: '/ledger', label: 'Ledger', Icon: IconLedger },
  { to: '/patients', label: 'Patients', Icon: IconPatients },
  { to: '/insights', label: 'Reports', Icon: IconReports },
  // Desktop-only — the mobile bottom tab bar is its own hand-built 5-item
  // row (Workspace/Patients/+New/Ledger/More), not driven by this array,
  // so adding a 6th entry here never adds a 6th phone tab (per the locked
  // spec's "no sixth phone tab" decision). Mobile reaches it via More.
  { to: '/requests', label: 'Requests', Icon: IconRequests },
  { to: '/settings', label: 'Settings', Icon: IconSettings },
] as const;

export function Shell() {
  const { loading, session } = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [syncKicked, setSyncKicked] = useState(false);
  const sync = useSyncExternalStore(syncStatus.subscribe, () => syncStatus.get());

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
          // Requests → Feedback is admin-only, but Bookings (Slice 5) is
          // front_desk's primary surface too — matching /insights' gate
          // just below, and the doc's "front desk + admin" nav rule.
          (item.to !== '/requests' || role === 'admin' || role === 'front_desk') &&
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

  // Default the active clinic to the first membership once data arrives,
  // and repair a stale pointer — `activeClinicId` can be set to an id that
  // no longer matches any locally known clinic (a removed membership, or
  // leftover device state from before a resync) — rather than leaving
  // `clinic` stuck at null forever with no UI able to fix it.
  const activeClinicKnown = activeClinicId != null && clinics?.some((c) => c.id === activeClinicId);
  useEffect(() => {
    if (clinics?.length && !activeClinicKnown) {
      void db.meta.put({ key: 'activeClinicId', value: clinics[0].id });
    }
  }, [clinics, activeClinicKnown]);

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

  // Public patient feedback link / public booking form — genuinely
  // unauthenticated (no session at all, not even a recovery one). Must
  // render before the `!session` check below would otherwise bounce an
  // anonymous patient to LoginPage.
  if (pathname.startsWith('/f/') || pathname.startsWith('/book/')) {
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
    //
    // `syncKicked` alone also isn't enough on its own: it flips true the
    // instant syncEngine.start() is *called*, not once its first pull has
    // actually landed. On a brand-new device an invited member's own
    // clinic_members/clinics rows haven't arrived yet at that point — local
    // Dexie is genuinely empty, which reads identically to "this account
    // really has zero clinics." Submitting CreateClinicForm in that window
    // creates a second, empty clinic and hides the one they were invited
    // to. `sync.lastSyncAt` is only set once a push+pull cycle has fully
    // completed (see SyncEngine.sync()), by which point a real clinic
    // membership would already be sitting in `clinics` above — so waiting
    // for it here is what actually confirms "zero clinics," not just
    // "haven't checked yet."
    const initialSyncSettled = sync.lastSyncAt != null;
    // A non-empty `clinics` list whose `activeClinicId` doesn't (yet)
    // match any of them is the repair effect above mid-flight, not a
    // confirmed zero-clinic account — wait for it rather than flashing
    // CreateClinicForm at someone who already has clinics.
    const repairingStalePointer = Boolean(clinics?.length) && !activeClinicKnown;
    if (
      !syncKicked ||
      clinics === undefined ||
      activeClinicId === undefined ||
      !initialSyncSettled ||
      repairingStalePointer
    ) {
      return (
        <Centered>
          <div className="space-y-2 text-center text-sm text-[var(--muted)]">
            <p>Preparing…</p>
            {syncKicked && !initialSyncSettled && sync.online === false && (
              <p className="text-xs">Waiting for a connection to check your clinic access…</p>
            )}
            {syncKicked && !initialSyncSettled && sync.online !== false && sync.error && (
              <p className="text-xs text-[var(--rust)]">Sync issue: {sync.error}</p>
            )}
          </div>
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
              <img
                src={logoUrl || '/apple-touch-icon.png'}
                alt=""
                className={
                  logoUrl
                    ? 'h-8 w-auto shrink-0 object-contain'
                    : 'h-8 w-8 shrink-0 rounded-[8px] object-contain'
                }
              />
              <div className="font-display truncate text-lg font-semibold text-[var(--ink)]">
                {clinic.name}
              </div>
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
              <AccountMenu
                displayName={displayName}
                fallbackName={fallbackName}
                role={role}
                setDisplayName={setDisplayName}
                clinicId={clinic.id}
                clinics={clinics ?? []}
              />
            </div>
          </div>
        </header>
        <SyncStatusBanners />
        <main className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:pb-6">
          <Suspense
            fallback={<div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div>}
          >
            <Outlet />
          </Suspense>
        </main>
        <nav
          className="no-print fixed inset-x-0 bottom-0 z-10 flex items-end border-t border-[var(--border)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] sm:hidden"
          aria-label="Main"
        >
          <PhoneTab
            to="/workspace"
            label="Workspace"
            Icon={IconWorkspace}
            active={pathname.startsWith('/workspace')}
          />
          <PhoneTab
            to="/patients"
            label="Patients"
            Icon={IconPatients}
            active={pathname.startsWith('/patients')}
          />
          <Link
            to="/visits/new"
            aria-label="New visit"
            className="flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center py-1"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--teal)] text-lg font-medium text-white">
              +
            </span>
            <span className="sr-only">New visit</span>
          </Link>
          <PhoneTab
            to="/ledger"
            label="Ledger"
            Icon={IconLedger}
            active={pathname.startsWith('/ledger')}
          />
          <PhoneTab
            to="/more"
            label="More"
            Icon={IconMore}
            active={
              pathname.startsWith('/more') ||
              pathname.startsWith('/settings') ||
              pathname.startsWith('/insights') ||
              pathname.startsWith('/requests')
            }
          />
        </nav>
      </div>
    </ClinicContext.Provider>
  );
}

function PhoneTab({
  to,
  label,
  Icon,
  active,
}: {
  to: '/workspace' | '/patients' | '/ledger' | '/more';
  label: string;
  Icon: (props: { className?: string }) => ReactNode;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium ${
        active ? 'text-[var(--teal)]' : 'text-[var(--muted)]'
      }`}
    >
      <Icon />
      {label}
    </Link>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center">{children}</div>;
}

/** First letters of up to two name words, skipping a leading honorific —
 *  "Dr. Prem Anand" -> "PA", "Ritu" -> "R". Purely decorative (the avatar
 *  circle in the account menu trigger), so a plain '?' fallback for an
 *  empty/unparseable name is fine — nothing downstream depends on it. */
function initialsFor(name: string): string {
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
 * The one account-corner menu, same markup at every breakpoint — the name/
 * role label collapses to just the avatar circle below `sm:`, same as the
 * old mobile-only hamburger did, but without maintaining a second, parallel
 * dropdown implementation. Houses: the click-to-edit name/role (via
 * `NameEditor`), a nudge toward the First Week setup checklist for an admin
 * who hasn't finished/dismissed it (`useFirstWeekChecklistSummary` —
 * SettingsPage's own card is the full version of this, this is a one-line
 * "N of M, continue" pointer to it), a clinic switcher (only rendered once
 * this account actually has 2+ clinics — most accounts never see it), an
 * admin-gated "Add another clinic" action, Change password, and Sign out.
 */
function AccountMenu({
  displayName,
  fallbackName,
  role,
  setDisplayName,
  clinicId,
  clinics,
}: {
  displayName: string | null;
  fallbackName: string;
  role: ClinicRole;
  setDisplayName: (name: string) => Promise<void>;
  clinicId: string;
  clinics: Clinic[];
}) {
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [addingClinic, setAddingClinic] = useState(false);
  const navigate = useNavigate();
  const name = displayName ?? fallbackName;
  const roleLabel = role !== 'unknown' ? CLINIC_ROLE_LABELS[role] : '';
  const setup = useFirstWeekChecklistSummary(clinicId);
  const showSetupNudge = role === 'admin' && setup?.visible === true;
  const sortedClinics = [...clinics].sort((a, b) => a.name.localeCompare(b.name));

  function switchClinic(id: string) {
    setOpen(false);
    if (id === clinicId) return;
    void db.meta.put({ key: 'activeClinicId', value: id });
    void navigate({ to: '/workspace' });
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
        <span className="hidden flex-col items-start sm:flex">
          <span className="text-xs font-medium text-[var(--ink)]">{name}</span>
          {roleLabel && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              {roleLabel}
            </span>
          )}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
            <NameEditor
              variant="mobile"
              displayName={displayName}
              fallbackName={fallbackName}
              role={role}
              setDisplayName={setDisplayName}
            />

            {showSetupNudge && setup && (
              <SetupNudgeLink setup={setup} onNavigate={() => setOpen(false)} />
            )}

            {sortedClinics.length > 1 && (
              <div className="border-t border-[var(--border)] py-1.5">
                <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
                  Clinics
                </div>
                {sortedClinics.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--ink)] hover:bg-[var(--paper)]"
                    onClick={() => switchClinic(c.id)}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.id === clinicId ? 'bg-[var(--teal)]' : 'bg-transparent'}`}
                      aria-hidden="true"
                    />
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            )}

            {role === 'admin' && (
              <div className="border-t border-[var(--border)] pt-1.5">
                <button
                  type="button"
                  className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-[var(--ink)] hover:bg-[var(--paper)]"
                  onClick={() => {
                    setOpen(false);
                    setAddingClinic(true);
                  }}
                >
                  Add another clinic
                </button>
              </div>
            )}

            <div className="border-t border-[var(--border)] pt-1.5">
              <button
                type="button"
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-[var(--ink)] hover:bg-[var(--paper)]"
                onClick={() => {
                  setOpen(false);
                  setChangingPassword(true);
                }}
              >
                Change password
              </button>
              <button
                type="button"
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-[var(--rust)] hover:bg-[var(--rust-light)]"
                onClick={() => getSupabase()?.auth.signOut()}
              >
                Sign out
              </button>
            </div>
          </div>
        </>
      )}

      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
      {addingClinic && (
        <AddClinicDialog
          onClose={() => setAddingClinic(false)}
          onCreated={() => {
            setAddingClinic(false);
            void syncEngine.schedule(0);
            void navigate({ to: '/workspace' });
          }}
        />
      )}
    </div>
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
      {roleLabel && (
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
