import type { PatientFlag } from '@/domain/patientFlags';

const DOT: Record<PatientFlag['key'], string> = {
  new: 'bg-[var(--teal)]',
  package: 'bg-[var(--plum)]',
  balance: 'bg-[var(--amber)]',
  noshow: 'bg-[var(--rust)]',
};

/** Up to two flag dots in a calendar block's corner — same flags as PatientFlagPills, shrunk to fit. */
export function BlockFlagBadges({ flags }: { flags: PatientFlag[] }) {
  if (!flags.length) return null;
  return (
    <span aria-hidden className="absolute right-0.5 top-0.5 z-[1] flex items-center gap-0.5 rounded-full bg-[var(--surface)]/70 px-0.5 py-0.5">
      {flags.slice(0, 2).map((flag) => (
        <span key={flag.key} className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[flag.key]}`} />
      ))}
    </span>
  );
}
