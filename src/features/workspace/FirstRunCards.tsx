import { Link } from '@tanstack/react-router';
import { btnPrimary } from '@/components/ui';
import { useSetupProgress } from '@/features/setup/useSetupProgress';
import type { UUID } from '@/domain/types';

/**
 * Cards at the top of Workspace while a new clinic has not seen the app work yet (admins only):
 * - no therapist: visits are credited to a therapist, so an empty roster sends the admin to Settings → Team;
 * - therapist but no visit yet: one prompt to log the first visit. It goes away on its own once a visit exists.
 */
export function FirstRunCards({ clinicId, isAdmin }: { clinicId: UUID; isAdmin: boolean }) {
  const setup = useSetupProgress(clinicId);
  if (!isAdmin || !setup) return null;
  if (setup.signals.hasTherapist) {
    if (setup.signals.visitLogged) return null;
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--teal-light)] bg-[var(--teal-mist)] p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--ink)]">You&apos;re set up. Log your first visit.</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">It takes under a minute: pick a patient, a service and save.</p>
        </div>
        <Link to="/visits/new" className={btnPrimary}>
          Log first visit
        </Link>
      </section>
    );
  }
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <p className="text-sm font-medium text-[var(--ink)]">Add a therapist to start logging visits</p>
      <Link to="/settings" search={{ tab: 'team', teamView: 'members' }} className={btnPrimary}>
        Add a therapist
      </Link>
    </section>
  );
}
