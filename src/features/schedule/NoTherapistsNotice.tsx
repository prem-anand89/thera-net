import { Link } from '@tanstack/react-router';
import { btnPrimary } from '@/components/ui';

/** Schedule with nobody on the roster: a way to add the first therapist instead of an empty grid. */
export function NoTherapistsNotice({ canManage }: { canManage: boolean }) {
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-center shadow-sm">
      <p className="font-display text-lg font-semibold text-[var(--ink)]">No therapists yet</p>
      <p className="text-sm text-[var(--muted)]">Bookings are made for a therapist. Add one to start using the schedule.</p>
      {canManage && (
        <Link to="/settings" search={{ tab: 'team', teamView: 'members' }} className={btnPrimary}>
          Add a therapist
        </Link>
      )}
    </section>
  );
}
