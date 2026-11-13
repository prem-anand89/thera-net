import { Link } from '@tanstack/react-router';
import { btnPrimary } from '@/components/ui';
import { useSetupProgress } from '@/features/setup/useSetupProgress';
import type { UUID } from '@/domain/types';

/**
 * Cards at the top of Workspace for a clinic that is not ready to log a visit yet. For now only the no-therapist
 * card: visits are credited to a therapist, so an admin with an empty roster is sent to Settings → Team.
 */
export function FirstRunCards({ clinicId, isAdmin }: { clinicId: UUID; isAdmin: boolean }) {
  const setup = useSetupProgress(clinicId);
  if (!isAdmin || !setup || setup.signals.hasTherapist) return null;
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <p className="text-sm font-medium text-[var(--ink)]">Add a therapist to start logging visits</p>
      <Link to="/settings" search={{ tab: 'team', teamView: 'members' }} className={btnPrimary}>
        Add a therapist
      </Link>
    </section>
  );
}
