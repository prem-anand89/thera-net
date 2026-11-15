// The 14-day adherence strip: one small square per day, coloured like the patient chart's strip. Shared by the Programs
// list (table and phone cards) so the colours and words match everywhere.
import type { DayCell } from './homeProgram';

export const CELL_CLASS: Record<DayCell['state'], string> = {
  all: 'bg-[var(--teal)] text-white',
  partial: 'bg-[var(--amber-light)] text-[var(--amber-strong)] border border-[var(--amber)]',
  missed: 'bg-[var(--rust-light)] text-[var(--rust)] border border-[var(--rust)]',
  today: 'border-2 border-[var(--teal)] text-[var(--teal-strong)]',
  outside: 'bg-[var(--paper)] text-[var(--muted)]',
};
export const CELL_WORD: Record<DayCell['state'], string> = { all: 'completed', partial: 'partly done', missed: 'missed', today: 'today', outside: 'not due' };

export function DayStrip({ days }: { days: DayCell[] }) {
  return (
    <div className="flex gap-0.5" role="group" aria-label="Adherence, last 14 days">
      {days.map((c) => <span key={c.date} role="img" aria-label={`${c.date}: ${CELL_WORD[c.state]}`} title={`${c.date}: ${CELL_WORD[c.state]}`} className={`h-4 w-3 shrink-0 rounded-sm ${CELL_CLASS[c.state]}`} />)}
    </div>
  );
}
