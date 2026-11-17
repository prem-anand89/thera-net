// "By exercise": each exercise's last 7 days, grouped Warm-up / Main exercises / Cool-down (`programBlocks`). A table
// from tablet width, a card per exercise on phones. Figures come from `itemWeek` (pure, tested); a picture shows only
// when the exercise has one and "Hide pictures in lists" is off (no empty tile otherwise).
import { Fragment, useMemo, type ReactNode } from 'react';
import { useClinic } from '@/app/clinicContext';
import { cellSub, td, th } from '@/components/ui';
import { useMediaQuery } from '@/components/useMediaQuery';
import { formatDateDM } from '@/domain/fiscalYear';
import { listThumbKey, type Exercise, type ProgramItem, type ProgramLog, type SessionsPerDay } from '@/domain/hep';
import { describeDose } from '@/domain/hepDose';
import type { SessionFeedback } from '@/services/hepService';
import { itemDose, programBlocks, programItemToInput } from './hepItems';
import { itemWeek, type ItemWeek, type WeekCellState } from './homeProgram';
import { useExercises, useThumbUrls } from './useHepData';

const TABLE_QUERY = '(min-width: 46.5rem)'; // the `tab:` breakpoint

const CELL: Record<WeekCellState, string> = {
  done: 'bg-[var(--teal)]',
  partial: 'bg-[var(--amber-light)] border border-[var(--amber)]',
  skipped: 'bg-[var(--amber)]',
  missed: 'bg-[var(--rust-light)] border border-[var(--rust)]',
  to_do: 'border-2 border-[var(--teal)]',
  not_due: 'bg-[var(--paper)]',
};
const CELL_WORD: Record<WeekCellState, string> = { done: 'completed', partial: 'partly done', skipped: 'skipped', missed: 'missed', to_do: 'to do', not_due: 'not due' };

function WeekCells({ week }: { week: ItemWeek }) {
  return (
    <span className="inline-flex gap-0.5" role="group" aria-label="Last 7 days">
      {week.days.map((d) => {
        const label = `${formatDateDM(d.date)}: ${CELL_WORD[d.state]}`;
        return <span key={d.date} role="img" aria-label={label} title={label} className={`h-4 w-3 shrink-0 rounded-sm ${CELL[d.state]}`} />;
      })}
    </span>
  );
}

function Flags({ week }: { week: ItemWeek }) {
  const flags = [
    week.pain > 0 && { text: `pain ×${week.pain}`, cls: 'bg-[var(--rust-light)] text-[var(--rust)]' },
    week.hard > 0 && { text: `felt hard ×${week.hard}`, cls: 'bg-[var(--rust-light)] text-[var(--rust)]' },
    week.skipped > 0 && { text: `skipped ×${week.skipped}`, cls: 'bg-[var(--amber-light)] text-[var(--amber-strong)]' },
  ].filter((f): f is { text: string; cls: string } => !!f);
  if (flags.length === 0) return <span className="text-[var(--muted)]">—</span>;
  return <span className="flex flex-wrap gap-1">{flags.map((f) => <span key={f.text} className={`rounded-full px-2 py-0.5 text-xs font-medium ${f.cls}`}>{f.text}</span>)}</span>;
}

interface Row { item: ProgramItem; week: ItemWeek; dose: string; thumb: string | undefined }

export function ByExerciseTable(props: {
  items: ProgramItem[];
  program: { startDate: string; durationDays: number | null; sessionsPerDay: SessionsPerDay };
  logs: ProgramLog[];
  feedback: SessionFeedback[];
  today: string;
  /** Shown under the heading (the By section line). */
  children?: ReactNode;
}) {
  const { items, program, logs, feedback, today } = props;
  const clinic = useClinic();
  const wide = useMediaQuery(TABLE_QUERY);
  const library = useExercises(clinic.id);
  const sources = useMemo(() => {
    const byId = new Map((library ?? []).map((e) => [e.id, e]));
    return items.map((i) => (i.sourceExerciseId ? byId.get(i.sourceExerciseId) : undefined));
  }, [library, items]);
  const pictured = useMemo(() => sources.filter((e): e is Exercise => !!e && !!listThumbKey(e)), [sources]);
  const thumbs = useThumbUrls(clinic.id, pictured);

  const groups = useMemo(() => {
    const rowOf = (index: number): Row => {
      const item = items[index];
      const src = sources[index];
      const tk = src ? listThumbKey(src) : null;
      return {
        item,
        week: itemWeek(item, logs, feedback, today, program),
        dose: describeDose(itemDose(programItemToInput(item)), program.sessionsPerDay),
        thumb: tk ? thumbs[tk] : undefined,
      };
    };
    const blocks = programBlocks(items.map(programItemToInput));
    return [
      { label: 'Warm-up', rows: blocks.warmUp.map((r) => rowOf(r.index)) },
      { label: 'Main exercises', rows: blocks.main.flatMap((s) => s.rows.map((r) => rowOf(r.index))) },
      { label: 'Cool-down', rows: blocks.coolDown.map((r) => rowOf(r.index)) },
    ].filter((g) => g.rows.length > 0);
  }, [items, sources, thumbs, logs, feedback, today, program]);

  const name = (r: Row) => (
    <span className="flex items-center gap-2">
      {r.thumb && <img src={r.thumb} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-lg border border-[var(--border)]/60 bg-[var(--surface)] p-0.5 object-contain" />}
      <span className="font-medium text-[var(--ink)]">{r.item.title}{r.item.optional && <span className="ml-2 text-xs font-normal text-[var(--muted)]">Optional</span>}</span>
    </span>
  );

  return (
    <section aria-label="By exercise" className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-3">
      <div className="px-3">
        <h3 className="font-display text-sm font-semibold text-[var(--ink)]">By exercise <span className="font-normal text-[var(--muted)]">· last 7 days</span></h3>
        {props.children}
      </div>
      {wide ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className={th}>Exercise</th><th className={th}>Dose</th><th className={th}>Done</th><th className={th}>Last 7 days</th><th className={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.label}>
                  <tr data-group className="bg-[var(--paper)]"><td colSpan={5} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{g.label}</td></tr>
                  {g.rows.map((r) => (
                    <tr key={r.item.id} className="border-b border-[var(--border)] last:border-0">
                      <td className={td}>{name(r)}</td>
                      <td className={td}><span className={cellSub}>{r.dose}</span></td>
                      <td className={`${td} font-num whitespace-nowrap`}>{r.week.doneDays} of 7 days</td>
                      <td className={td}><WeekCells week={r.week} /></td>
                      <td className={td}><Flags week={r.week} /></td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-3 px-3">
          {groups.map((g) => (
            <div key={g.label} className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{g.label}</h4>
              <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
                {g.rows.map((r) => (
                  <li key={r.item.id} className="space-y-1.5 p-3">
                    {name(r)}
                    <p className="text-xs text-[var(--muted)]">{r.dose}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-num text-[var(--ink)]">{r.week.doneDays} of 7 days</span>
                      <WeekCells week={r.week} />
                    </div>
                    {(r.week.pain > 0 || r.week.hard > 0 || r.week.skipped > 0) && <Flags week={r.week} />}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
