import type { Appointment } from '@/domain/types';
import type { PatientFlag } from '@/domain/patientFlags';

const DOT: Record<PatientFlag['key'], string> = {
  new: 'bg-[var(--teal)]',
  package: 'bg-[var(--plum)]',
  balance: 'bg-[var(--amber)]',
  noshow: 'bg-[var(--rust)]',
};

/** Most urgent first, so the two dots a block has room for are the ones staff act on. */
const URGENCY: PatientFlag['key'][] = ['noshow', 'balance', 'new', 'package'];

/** What each dot colour means (the legend under the calendar uses the same list). */
export const FLAG_LEGEND: { key: PatientFlag['key']; label: string; hint: string }[] = [
  { key: 'new', label: 'New patient', hint: 'No visits on record yet' },
  { key: 'package', label: 'Open package', hint: 'Has sessions left on a package' },
  { key: 'balance', label: 'Balance due', hint: 'Still owes money on an earlier visit' },
  { key: 'noshow', label: 'May not show', hint: 'Has missed or cancelled 2 or more appointments' },
];

/** Dots only help while there is still something to do: not once the visit is logged, or the slot was cancelled or missed. */
export function showsFlagDots(appointment: Pick<Appointment, 'status' | 'visitId'>): boolean {
  return !appointment.visitId && appointment.status !== 'cancelled' && appointment.status !== 'no_show';
}

/** Up to two flag dots in a calendar block's corner — same flags as PatientFlagPills, shrunk to fit. */
export function BlockFlagBadges({ flags }: { flags: PatientFlag[] }) {
  if (!flags.length) return null;
  const shown = [...flags].sort((a, b) => URGENCY.indexOf(a.key) - URGENCY.indexOf(b.key)).slice(0, 2);
  return (
    <span
      title={flags.map((f) => f.label).join(', ')}
      className="absolute right-0.5 top-0.5 z-[1] flex items-center gap-0.5 rounded-full bg-[var(--surface)]/70 px-0.5 py-0.5"
    >
      {shown.map((flag) => (
        <span key={flag.key} aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[flag.key]}`} />
      ))}
      <span className="sr-only">{flags.map((f) => f.label).join(', ')}</span>
    </span>
  );
}

/** "What do the dots mean?" — a small disclosure under the calendar. */
export function FlagLegend() {
  return (
    <details className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--muted)]">
      <summary className="min-h-8 cursor-pointer py-1.5 font-medium">What do the dots on appointments mean?</summary>
      <ul className="space-y-1.5 pb-2 pt-1">
        {FLAG_LEGEND.map((f) => (
          <li key={f.key} className="flex items-center gap-2">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[f.key]}`} />
            <span className="font-medium text-[var(--ink)]">{f.label}</span>
            <span>· {f.hint}</span>
          </li>
        ))}
        <li className="pt-0.5">Dots show only until the visit is logged (not on cancelled or missed slots). A block has room for two, most urgent first: may not show, balance due, new, package. Tap the appointment to see all of them.</li>
      </ul>
    </details>
  );
}
