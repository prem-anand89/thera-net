import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ALL_SYNCED_TABLES } from '@/lib/db';
import { publicLogoUrl } from '@/lib/supabase';
import { syncEngine } from '@/sync/engine';
import { syncStatus } from '@/sync/status';
import { useSession } from './useSession';
import { useClinicRole } from './useClinicRole';
import { ClinicContext } from './clinicContext';
import { LoginPage } from '@/features/auth/LoginPage';
import { CreateClinicForm } from '@/features/settings/CreateClinicForm';
import { activePhoneTab, isAccountAreaActive, isNavActive } from './navActive';
import { SyncBadge, SyncStatusBanners } from '@/components/SyncBadge';
import { NotificationBell } from '@/components/NotificationBell';
import {
  clinicNeedsOnboarding,
  isPathAllowedDuringClinicOnboarding,
  therapistNeedsProfileConfirm,
} from '@/domain/onboarding';
import { repos } from '@/services';
import {
  IconWorkspace,
  IconLedger,
  IconPatients,
  IconReports,
  IconCalendar,
  IconMore,
} from '@/components/NavIcons';
import { AccountMenu } from './AccountMenu';
import { ClinicSwitcher } from './ClinicSwitcher';
import { AppLoading, BrandMark } from '@/components/BrandMark';



const NAV = [
  { to: '/workspace', label: 'Workspace', Icon: IconWorkspace },
  { to: '/schedule', label: 'Schedule', Icon: IconCalendar },
  { to: '/ledger', label: 'Ledger', Icon: IconLedger },
  { to: '/patients', label: 'Patients', Icon: IconPatients },
  { to: '/insights', label: 'Reports', Icon: IconReports },
  // Settings deliberately isn't in this array — it sits in the account
  // menu's Account section instead, under the same `role === 'admin'` gate
  // this array's filter used to apply. Five labelled items is what the
  // header row can actually carry (see the layout comment on <header>);
  // Settings was the sixth, and the least-often-visited of them. Mobile is
  // unaffected either way — More has always been its route there.
] as const;

export function Shell() {
  const { loading, session } = useSession();
  const navigate = useNavigate();
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
  const { role, displayName, setDisplayName, loading: roleLoading } = useClinicRole(
    clinic?.id ?? ''
  );
  const therapists = useLiveQuery(
    () => (clinic ? repos.therapists.list(clinic.id) : []),
    [clinic?.id]
  );
  // Same resolution useWorkspaceScope() uses — can't call that hook here,
  // it needs ClinicContext, and this component is the one that provides
  // it further down (same constraint noted on appointmentRequests below).
  const myTherapistId = useMemo(
    () => therapists?.find((t) => t.userId === session?.user?.id)?.id,
    [therapists, session?.user?.id]
  );

  const appointmentRequests = useLiveQuery(
    () => clinic && (role === 'admin' || role === 'front_desk') ? repos.appointmentRequests.listByClinic(clinic.id) : undefined,
    [clinic?.id, role]
  );
  const pendingRequestsCount = appointmentRequests?.filter(r => r.status === 'pending').length ?? 0;
  // Local-part of the email, not the full address — the account area used
  // to show the raw email everywhere; this is the fallback for anyone who
  // hasn't set a display name yet, not a full replacement for a real name.
  const fallbackName = session?.user?.email?.split('@')[0] ?? 'Account';
  // Reports (Dashboard + monthly statement) is admin/front_desk only —
  // aggregates stay off-limits to a plain therapist (decision 3), hidden
  // during 'unknown' role resolution too, not just for a confirmed
  // therapist, so the item never flashes visible before role settles.
  // The phone bar's + (New visit) returns to the page it was tapped on.
  const newVisitFrom = (['/workspace', '/schedule', '/ledger', '/patients'] as const).find((p) =>
    pathname.startsWith(p)
  );
  const nav = useMemo(
    () =>
      NAV.filter(
        (item) =>
          // Schedule is for every role: admin / front desk see the whole
          // clinic, a therapist sees and books their own column (the page
          // scopes itself; the booking RPCs enforce it). Hidden only while
          // the role is still resolving.
          (item.to !== '/schedule' || role !== 'unknown') &&
          (item.to !== '/insights' || role === 'admin' || role === 'front_desk')
      ),
    [role]
  );

  const prevUserId = useRef<string | null>(null);

  useEffect(() => {
    // `loading` is true (and `session` is still its `null` initializer) for
    // one render on every mount, before the async getSession() call has
    // actually resolved — that's a placeholder, not a confirmed sign-out.
    // Without this guard, that transient null fired the clear branch below
    // on every single app launch/reload, wiping the outbox (any local
    // writes — e.g. a newly added patient — not yet pushed to the server)
    // before the real session even had a chance to load, silently and
    // permanently discarding unsynced work.
    if (loading) return;

    const currentUserId = session?.user?.id ?? null;
    const isSwappingUsers = prevUserId.current != null && currentUserId !== prevUserId.current;

    // Clear local Dexie data when user signs out OR when hot-swapping to a 
    // different account (e.g. clicking a magic link while already logged in)
    // to prevent leaking cached data from one account to another. 
    if (!session || isSwappingUsers) {
      void (async () => {
        await syncEngine.stop();
        for (const table of ALL_SYNCED_TABLES) await db.table(table).clear();
        await db.outbox.clear();
        await db.meta.clear();
        syncStatus.reset();
      })();
    }

    if (session) {
      syncEngine.start();
      syncEngine.schedule(0);
      setSyncKicked(true);
    }

    prevUserId.current = currentUserId;
  }, [session, loading]);

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

  // Invited members who haven't chosen a password yet — Shell would otherwise
  // drop them straight into Workspace with a session but no password set.
  useEffect(() => {
    if (!session?.user || pathname === '/reset-password') return;
    if (session.user.user_metadata?.require_password_setup === true) {
      void navigate({ to: '/reset-password' });
    }
  }, [session, pathname, navigate]);

  // Clinic setup wizard is admin-only (RLS would block writes; redirect avoids confusion).
  useEffect(() => {
    if (pathname !== '/onboarding' || !clinic || roleLoading) return;
    if (role !== 'admin') {
      void navigate({ to: '/workspace' });
    }
  }, [clinic, role, roleLoading, pathname, navigate]);

  // New-clinic admins must finish /onboarding before any other in-app route.
  useEffect(() => {
    if (!clinic || role !== 'admin') return;
    if (!clinicNeedsOnboarding(clinic)) {
      if (pathname === '/onboarding') {
        void navigate({ to: '/workspace' });
      }
      return;
    }
    if (!isPathAllowedDuringClinicOnboarding(pathname)) {
      void navigate({ to: '/onboarding', search: { step: 2 } });
    }
  }, [clinic, role, pathname, navigate]);

  // Linked roster members confirm invoice name / registration no. (server-backed).
  useEffect(() => {
    if (!clinic || !session?.user?.id || pathname === '/reset-password') return;
    if (role === 'admin' && clinicNeedsOnboarding(clinic)) return;
    if (therapists === undefined) return;
    const selfRow = therapists.find((t) => t.userId === session.user.id);
    const needsProfile = therapistNeedsProfileConfirm(selfRow, session.user.id);
    if (pathname === '/onboarding/profile') {
      if (!needsProfile) void navigate({ to: '/workspace' });
      return;
    }
    if (needsProfile && !isPathAllowedDuringClinicOnboarding(pathname)) {
      void navigate({ to: '/onboarding/profile' });
    }
  }, [clinic, session, therapists, pathname, navigate, role]);

  // The recovery link's own auth flow doesn't need session/clinic gating —
  // it may be opened by someone whose local session has expired, and it
  // must render before those checks would otherwise redirect to login.
  if (pathname === '/reset-password') {
    return (
      <Suspense fallback={<AppLoading />}>
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
      <Suspense fallback={<AppLoading />}>
        <Outlet />
      </Suspense>
    );
  }

  if (loading) return <AppLoading />;
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
        <AppLoading label="Preparing…">
          {syncKicked && !initialSyncSettled && sync.online === false && (
            <p className="text-xs text-[var(--muted)]">Waiting for a connection to check your clinic access…</p>
          )}
          {syncKicked && !initialSyncSettled && sync.online !== false && sync.error && (
            <p className="text-xs text-[var(--rust)]">Sync issue: {sync.error}</p>
          )}
        </AppLoading>
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
        <Suspense fallback={<AppLoading />}>
          <Outlet />
        </Suspense>
      </ClinicContext.Provider>
    );
  }

  return (
    <ClinicContext.Provider value={clinic}>
      <div className="min-h-screen bg-[var(--paper)]">
        <header className="no-print sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)] pt-[env(safe-area-inset-top)]">
          {/* Header layout. Left: the Thera.Net mark (the product; wordmark
              from desktop:). Middle: nav, sm:-and-up only — the bottom tab
              bar replaces it on phones. Right: the clinic pill (where you
              are: the clinic's own logo + name, and the clinic switcher),
              then sync and the account avatar. Keeping the clinic on the
              right, as its own bordered pill, stops it blurring into the
              app brand. Width budget inside max-w-6xl:
                1. Only the clinic name shrinks (truncates). Nav and the
                   sync/account cluster are shrink-0, so a tight row eats
                   into the name rather than squeezing things you click.
                2. Nav labels: every item from desktop:; on iPad widths
                   (tab: to desktop:) only the active item, the rest are
                   icons with tooltips + aria-labels (all five labels plus
                   the clinic pill don't fit 744–999px); icons only below.
                3. SyncBadge is just a dot while there's nothing to say, and
                   expands with text at every width when there is.
                4. The account trigger's name shows from desktop: only; the
                   dropdown repeats it anyway. */}
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 tab:gap-4">
            <Link to="/workspace" aria-label="Thera.Net — Workspace" className="flex min-h-11 shrink-0 items-center rounded-lg">
              <BrandMark size={30} wordmark wordmarkClassName="hidden text-base desktop:inline" />
            </Link>
            <nav className="hidden shrink-0 gap-1 sm:flex">
              {nav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  // Icon-only below tab:, so the accessible name has to
                  // come from the attribute rather than the hidden span —
                  // `hidden` is display:none, which screen readers skip.
                  aria-label={item.label}
                  aria-current={isNavActive(pathname, item.to) ? 'page' : undefined}
                  title={item.label}
                  activeProps={{}}
                  className={`flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors motion-reduce:transition-none desktop:px-3 ${
                    isNavActive(pathname, item.to)
                      ? 'bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                      : 'text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]'
                  }`}
                >
                  <item.Icon className={`shrink-0 ${isNavActive(pathname, item.to) ? '[&_path]:stroke-[2.1]' : ''}`} />
                  <span className={`${isNavActive(pathname, item.to) ? 'hidden tab:inline' : 'hidden desktop:inline'}`}>{item.label}</span>
                  {item.to === '/schedule' && pendingRequestsCount > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--rust)] px-1 text-[10px] font-bold text-white">
                      {pendingRequestsCount}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex min-w-0 items-center gap-2 tab:gap-3">
              <div className="flex min-w-0 justify-end">
                <ClinicSwitcher clinic={clinic} clinics={clinics ?? []} logoUrl={logoUrl} isAdmin={role === 'admin'} />
              </div>
              <div className="flex shrink-0 items-center gap-1 tab:gap-2">
              {(role === 'admin' || role === 'front_desk') && (
                <NotificationBell
                  clinicId={clinic.id}
                  pendingRequestsCount={pendingRequestsCount}
                  isAdmin={role === 'admin'}
                />
              )}
              {role === 'therapist' && myTherapistId && (
                <NotificationBell
                  clinicId={clinic.id}
                  pendingRequestsCount={0}
                  isAdmin={false}
                  therapistId={myTherapistId}
                />
              )}
              <SyncBadge />
              <AccountMenu
                active={isAccountAreaActive(pathname)}
                displayName={displayName}
                fallbackName={fallbackName}
                role={role}
                setDisplayName={setDisplayName}
                clinicId={clinic.id}
                hasPasswordIdentity={
                  session?.user.identities?.some((i) => i.provider === 'email') ?? true
                }
              />
              </div>
            </div>
          </div>
        </header>
        <SyncStatusBanners />
        <main className="mx-auto max-w-6xl px-[max(1rem,env(safe-area-inset-left))] py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-6">
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
            active={activePhoneTab(pathname) === '/workspace'}
          />
          <PhoneTab
            to="/schedule"
            label="Schedule"
            Icon={IconCalendar}
            active={activePhoneTab(pathname) === '/schedule'}
            badge={pendingRequestsCount}
          />
          <Link
            to="/visits/new"
            search={newVisitFrom ? { from: newVisitFrom } : {}}
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
            active={activePhoneTab(pathname) === '/ledger'}
          />
          <PhoneTab
            to="/more"
            label="More"
            Icon={IconMore}
            active={activePhoneTab(pathname) === '/more'}
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
  badge,
}: {
  to: '/workspace' | '/patients' | '/ledger' | '/more' | '/schedule';
  label: string;
  Icon: (props: { className?: string }) => ReactNode;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] ${
        active ? 'font-semibold text-[var(--teal-strong)]' : 'font-medium text-[var(--muted)]'
      }`}
    >
      <div
        className={`relative flex h-7 w-14 items-center justify-center rounded-full transition-colors motion-reduce:transition-none ${
          active ? 'bg-[var(--teal-light)] [&_path]:stroke-[2.1]' : ''
        }`}
      >
        <Icon />
        {badge !== undefined && badge > 0 && (
          <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-[var(--surface)] bg-[var(--rust)] px-0.5 text-[9px] font-bold text-white">
            {badge}
          </span>
        )}
      </div>
      {label}
    </Link>
  );
}


