// The program card on the Home program tab: title and status, Edit program / Message patient / the ⋮ menu, one sub
// line, the "Day N of M" bar with its dates, and the patient's link line. Presentational: the tab owns the actions.
import type { ReactNode } from 'react';
import { Button } from '@/components/Button';
import { KebabMenu, pillSmAccent } from '@/components/ui';
import type { Program } from '@/domain/hep';
import { programDateRange } from './homeProgram';
import type { ProgramRow } from './programRows';

const STATUS_PILL: Record<'active' | 'paused' | 'ended' | 'completed', { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-[var(--teal-light)] text-[var(--teal-strong)]' },
  paused: { label: 'Paused', cls: 'bg-[var(--paper)] text-[var(--muted)]' },
  ended: { label: 'Ended', cls: 'bg-[var(--amber-light)] text-[var(--amber-strong)]' },
  completed: { label: 'Completed', cls: 'bg-[var(--paper)] text-[var(--muted)]' },
};

export type ProgramStatusKey = keyof typeof STATUS_PILL;

/** One status for the card's pill and the program chips: completed, paused, ended (active but past its last day) or active. */
export function programStatusKey(row: Pick<ProgramRow, 'status' | 'ended'>): ProgramStatusKey {
  return row.status === 'completed' ? 'completed' : row.status === 'paused' ? 'paused' : row.ended ? 'ended' : 'active';
}
export const programStatusWord = (key: ProgramStatusKey) => STATUS_PILL[key].label.toLowerCase();

/** How far through the program today is: day number and length, or null for an ongoing one. */
function dayProgress(program: Pick<Program, 'startDate' | 'durationDays' | 'status'>, today: string): { day: number; of: number } | null {
  if (!program.durationDays) return null;
  const n = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${program.startDate}T00:00:00Z`)) / 86_400_000) + 1;
  return { day: Math.min(Math.max(n, 1), program.durationDays), of: program.durationDays };
}

export function ProgramCard(props: {
  program: Program;
  row: ProgramRow;
  today: string;
  subLine: string;
  online: boolean;
  canMessage: boolean;
  onEdit: () => void;
  onMessage: () => void;
  menu: (close: () => void) => ReactNode;
  linkLine: ReactNode;
}) {
  const { program: prog, row } = props;
  const status = programStatusKey(row);
  const pill = STATUS_PILL[status];
  const progress = dayProgress(prog, props.today);
  const barLabel = status === 'completed' ? 'Completed' : row.dayLabel;
  return (
    <section aria-label="Program" className="space-y-2.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-lg font-semibold text-[var(--ink)]">{prog.title} <span className={`ml-1 rounded-full px-2 py-0.5 align-middle text-xs font-medium ${pill.cls}`}>{pill.label}</span></h2>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          {prog.status !== 'completed' && <Button type="button" className={pillSmAccent} disabled={!props.online} onClick={props.onEdit}>Edit program</Button>}
          <Button type="button" className={pillSmAccent} disabled={!props.canMessage} onClick={props.onMessage}>Message patient</Button>
          <KebabMenu ariaLabel="More actions">{props.menu}</KebabMenu>
        </div>
      </div>
      <p className="text-sm text-[var(--muted)]">{props.subLine}</p>
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-[var(--ink)]">{barLabel}</span>
          <span className="text-[var(--muted)]">{programDateRange(prog.startDate, prog.durationDays)}</span>
        </div>
        {progress && (
          <div role="progressbar" aria-label={`Day ${progress.day} of ${progress.of}`} aria-valuemin={1} aria-valuemax={progress.of} aria-valuenow={progress.day} className="h-1.5 overflow-hidden rounded-full bg-[var(--paper)]">
            <div className={`h-full rounded-full ${status === 'active' ? 'bg-[var(--teal)]' : 'bg-[var(--muted)]'}`} style={{ width: `${Math.round((progress.day / progress.of) * 100)}%` }} />
          </div>
        )}
      </div>
      {props.linkLine}
    </section>
  );
}
