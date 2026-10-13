import { Link } from '@tanstack/react-router';
import { IconChevronLeft } from '@/components/StatIcons';

type BackLinkProps = {
  to: '/ledger' | '/workspace' | '/schedule';
  search?: { tab: 'patients' };
  label: string;
};

/** Compact "‹ Patients" pill: names where Back goes, so the destination is never a guess. */
export function BackLink({ to, search, label }: BackLinkProps) {
  const cls =
    'inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 pl-1.5 pr-3 text-sm font-medium text-[var(--muted)] transition-colors hover:border-[var(--teal)]/40 hover:bg-[var(--paper)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--teal)]';
  const content = (
    <>
      <IconChevronLeft className="h-4 w-4" aria-hidden="true" />
      <span>{label}</span>
    </>
  );
  return to === '/ledger' ? (
    <Link to="/ledger" search={search} className={cls} aria-label={`Back to ${label}`}>
      {content}
    </Link>
  ) : (
    <Link to={to} className={cls} aria-label={`Back to ${label}`}>
      {content}
    </Link>
  );
}
