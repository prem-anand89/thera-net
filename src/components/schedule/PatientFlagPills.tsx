import type { PatientFlag } from '@/domain/patientFlags';

const STYLE: Record<PatientFlag['key'], string> = {
  new: 'bg-[var(--teal-light)] text-[var(--teal-strong)]',
  package: 'bg-[var(--plum-light)] text-[var(--plum)]',
  balance: 'bg-[var(--amber-light)] text-[var(--amber)]',
  noshow: 'bg-[var(--rust-light)] text-[var(--rust)]',
};

/**
 * Patient flags as quiet pills (`patientFlags`). `max` keeps list rows to
 * one line; the details panel passes none to show them all. A no-show flag
 * renders as a dot with the count in its label, so it stays small.
 */
export function PatientFlagPills({ flags, max }: { flags: PatientFlag[]; max?: number }) {
  if (!flags.length) return null;
  const shown = max === undefined ? flags : flags.slice(0, max);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((flag) =>
        flag.key === 'noshow' && max !== undefined ? (
          <span key={flag.key} title={flag.label} aria-label={flag.label} className="h-2 w-2 shrink-0 rounded-full bg-[var(--rust)]" />
        ) : (
          <span key={flag.key} className={`whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-medium leading-4 ${STYLE[flag.key]}`}>
            {flag.label}
          </span>
        )
      )}
    </span>
  );
}
