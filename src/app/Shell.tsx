import { Suspense, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { getSupabase, publicLogoUrl } from '@/lib/supabase';
import { syncEngine } from '@/sync/engine';
import { useSession } from './useSession';
import { ClinicContext } from './clinicContext';
import { LoginPage } from '@/features/auth/LoginPage';
import { SyncBadge } from '@/components/SyncBadge';
import { btnSecondary } from '@/components/ui';

const NAV = [
  { to: '/workspace', label: 'Workspace' },
  { to: '/archive', label: 'Archive' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/insights', label: 'Insights' },
  { to: '/setup', label: 'Setup' },
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

  useEffect(() => {
    if (session) {
      syncEngine.start();
      syncEngine.schedule(0);
      setSyncKicked(true);
    } else {
      // Clear local Dexie data when user signs out to prevent leaking
      // cached data from one account to another
      void db.clinics.clear();
      void db.therapists.clear();
      void db.service_catalog.clear();
      void db.patients.clear();
      void db.visits.clear();
      void db.invoices.clear();
      void db.invoice_payments.clear();
      void db.payments.clear();
      void db.settlements.clear();
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
    return (
      <Centered>
        <div className="max-w-md space-y-3 text-center text-sm text-[var(--muted)]">
          <p className="font-display text-base font-medium text-[var(--ink)]">
            {syncKicked ? "You're signed in, but not on a clinic yet" : 'Preparing…'}
          </p>
          {syncKicked && (
            <p>Ask your clinic admin to add your login, then come back and retry.</p>
          )}
          <button className={btnSecondary} onClick={() => syncEngine.schedule(0)}>
            Retry sync
          </button>
          <button className={btnSecondary} onClick={() => getSupabase()?.auth.signOut()}>
            Sign out
          </button>
          {syncKicked && (
            <details className="pt-2 text-left text-xs text-[var(--muted)]">
              <summary className="cursor-pointer select-none text-center">Technical details</summary>
              <p className="mt-2">
                A membership row links your Supabase auth user to a clinic in{' '}
                <code>clinic_members</code>. See <code>supabase/provision_clinic.sql</code> (new
                clinic) or add a row manually, then retry sync.
              </p>
            </details>
          )}
        </div>
      </Centered>
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
            {/* Desktop nav */}
            <nav className="hidden gap-1 sm:flex">
              {NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="rounded-md px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--paper)] [&.active]:bg-[var(--teal-light)] [&.active]:font-medium [&.active]:text-[var(--teal)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-4">
              <SyncBadge />
              <div className="hidden flex-col items-end gap-1 sm:flex">
                <div className="text-xs text-[var(--muted)]">{session.user?.email}</div>
                <button
                  className="text-xs text-[var(--muted)] hover:text-[var(--ink)]"
                  onClick={() => getSupabase()?.auth.signOut()}
                >
                  Sign out
                </button>
              </div>
              {/* Mobile menu toggle */}
              <button
                className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--paper)] sm:hidden"
                aria-label="Menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  {menuOpen ? (
                    <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  ) : (
                    <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  )}
                </svg>
              </button>
            </div>
          </div>
          {/* Mobile nav panel */}
          {menuOpen && (
            <nav className="border-t border-[var(--border)] bg-[var(--surface)] px-2 py-2 sm:hidden">
              {NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-md px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--paper)] [&.active]:bg-[var(--teal-light)] [&.active]:font-medium [&.active]:text-[var(--teal)]"
                >
                  {item.label}
                </Link>
              ))}
              <button
                className="mt-1 block w-full rounded-md px-3 py-2 text-left text-sm text-[var(--muted)] hover:bg-[var(--paper)]"
                onClick={() => getSupabase()?.auth.signOut()}
              >
                Sign out
              </button>
            </nav>
          )}
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">
          <Suspense fallback={<div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </ClinicContext.Provider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center">{children}</div>;
}
