// The two cards under the stats row: left, the last 14 days (tap a day to see it) and the pain and effort trend;
// right, the chosen day (Today by default) session by session, with a "Yesterday:" line under Today.
import { Button } from '@/components/Button';
import { formatDateDM } from '@/domain/fiscalYear';
import { CELL_CLASS, CELL_WORD } from './DayStrip';
import { SKIP_REASON_LABEL, type DayCell, type TimelineSession } from './homeProgram';
import { ProgramTrend } from './ProgramTrend';

const LEGEND: Array<{ word: string; cls: string }> = [
  { word: 'Completed', cls: CELL_CLASS.all },
  { word: 'Partly done', cls: CELL_CLASS.partial },
  { word: 'Missed', cls: CELL_CLASS.missed },
  { word: 'Not due', cls: `${CELL_CLASS.outside} border border-[var(--border)]` },
];

const weekday = (iso: string, style: 'short' | 'long') => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: style, timeZone: 'UTC' });

export function ProgramDays(props: {
  strip: DayCell[];
  day: string;
  today: string;
  onDay: (date: string) => void;
  timeline: TimelineSession[];
  /** "3 done, 1 skipped (Pain)" for yesterday, shown under Today. */
  yesterday: string | null;
  todayCount: string | null;
  trend: Array<{ date: string; pain: number | null; effort: number | null }>;
  fmtTime: (iso: string | null) => string;
}) {
  const { day, today, timeline } = props;
  const isToday = day === today;
  return (
    <div className="grid grid-cols-1 items-start gap-3 desktop:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="text-sm font-semibold text-[var(--ink)]">Last 14 days <span className="font-normal text-[var(--muted)]">· tap a day to see what was done</span></p>
        <div className="grid grid-cols-7 gap-1 tab:grid-cols-14" role="group" aria-label="Last 14 days">
          {props.strip.map((c) => (
            <button key={c.date} type="button" title={`${weekday(c.date, 'long')} ${formatDateDM(c.date)}`} aria-label={`${c.date}: ${CELL_WORD[c.state]}`} aria-pressed={c.date === day} onClick={() => props.onDay(c.date)} className={`flex h-11 flex-col items-center justify-center rounded-lg text-xs font-medium leading-tight ${CELL_CLASS[c.state]} ${c.date === day ? 'ring-2 ring-[var(--ink)]' : ''}`}>
              <span className="text-[10px] uppercase opacity-80">{weekday(c.date, 'short').slice(0, 2)}</span>
              <span className="text-sm">{Number(c.date.slice(8, 10))}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
          {LEGEND.map((l) => <span key={l.word} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm ${l.cls}`} />{l.word}</span>)}
        </div>
        <ProgramTrend series={props.trend} />
      </div>

      <section aria-label="Day" className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="font-display text-sm font-semibold text-[var(--ink)]">{isToday ? 'Today' : weekday(day, 'short')}, {formatDateDM(day)}</h4>
          {isToday && props.todayCount && <span className="text-xs text-[var(--muted)]">{props.todayCount}</span>}
          {!isToday && <Button type="button" className="text-xs font-medium text-[var(--teal)]" onClick={() => props.onDay(today)}>Back to today</Button>}
        </div>
        {timeline.length === 0 && <p className="text-sm text-[var(--muted)]">Nothing was due this day.</p>}
        {timeline.map((s) => (
          <div key={s.index} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h5 className="text-sm font-medium text-[var(--ink)]">{s.label}</h5>
              {s.pain != null && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.pain >= 7 ? 'bg-[var(--rust-light)] text-[var(--rust)]' : 'bg-[var(--paper)] text-[var(--muted)]'}`}>Pain {s.pain}/10</span>}
              {s.effort != null && <span className="rounded-full bg-[var(--paper)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">Effort {s.effort}/10</span>}
            </div>
            {(s.hurt.length > 0 || s.hardest.length > 0) && <p className="text-xs text-[var(--muted)]">{s.hurt.length > 0 && <>Hurt: {s.hurt.join(', ')}. </>}{s.hardest.length > 0 && <>Hardest: {s.hardest.join(', ')}.</>}</p>}
            <ul className="divide-y divide-[var(--border)] text-sm">
              {s.entries.map((e) => (
                <li key={e.itemId} className="flex flex-wrap items-center gap-x-2 py-1">
                  <span aria-hidden="true" className={e.status === 'done' ? 'text-[var(--teal)]' : e.status === 'skipped' ? 'text-[var(--amber-strong)]' : e.status === 'not_done' ? 'text-[var(--rust)]' : 'text-[var(--muted)]'}>{e.status === 'done' ? '✓' : e.status === 'skipped' ? '↷' : e.status === 'not_done' ? '✕' : '○'}</span>
                  <span className="flex-1 text-[var(--ink)]">{e.title}{e.optional ? ' (optional)' : ''}</span>
                  <span className="text-xs text-[var(--muted)]">{e.status === 'done' ? `Done ${props.fmtTime(e.at)}` : e.status === 'skipped' ? `Skipped${e.reason ? `: ${SKIP_REASON_LABEL[e.reason]}` : ''}` : e.status === 'not_done' ? 'Not done' : 'To do'}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {isToday && props.yesterday && <p className="text-xs text-[var(--muted)]">Yesterday: {props.yesterday}</p>}
      </section>
    </div>
  );
}
