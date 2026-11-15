// The checklist: the program's sections as cards, one tick per exercise for the chosen session, All done and Skip ›
// for a whole section, and one big Start / Continue button (amendments 81 and 82).
import { useState } from 'react';
import type { SkipReason } from '@/domain/hep';
import type { PublicHepItem } from '@/services/publicHepService';
import { SKIP_REASONS, itemsInSession, nextToDo, sectionLabelCount, sectionsOf, sessionLabel, shortDose, statusOf, type PublicLog } from './hepSession';

export interface HepChecklistProps {
  items: PublicHepItem[];
  logs: PublicLog[];
  today: string;
  session: number;
  sessionCount: number;
  onSession: (session: number) => void;
  onOpen: (item: PublicHepItem) => void;
  /** One tap: done, or Undo when it already has a status. */
  onToggle: (item: PublicHepItem) => void;
  onSectionDone: (items: PublicHepItem[]) => void;
  onSectionSkip: (items: PublicHepItem[], reason: SkipReason) => void;
  /** Lets a caller hide an exercise's picture in the list. Default: shown when it has pictures and the therapist did not
   *  switch on "Hide pictures in lists" (`hidePicturesInLists`, which always wins). */
  showThumb?: (item: PublicHepItem) => boolean;
  /** Where the sticky Start button rests: above the patient page's tab bar. A literal Tailwind class. Default `bottom-0`. */
  startBottom?: string;
}

const SECTION_REASONS = SKIP_REASONS.filter((r) => r.value !== 'didnt_understand');

function Tick({ status, title, onClick }: { status: 'done' | 'skipped' | 'open'; title: string; onClick: () => void }) {
  const label = status === 'open' ? `Mark ${title} as done` : status === 'done' ? `Undo ${title}` : `Undo skipping ${title}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={status !== 'open'}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 text-xl font-bold ${status === 'done' ? 'border-teal-700 bg-teal-700 text-white' : status === 'skipped' ? 'border-slate-400 bg-slate-200 text-slate-600' : 'border-slate-400 bg-white text-transparent'}`}
    >
      {status === 'skipped' ? '–' : '✓'}
    </button>
  );
}

export function HepChecklist({ items, logs, today, session, sessionCount, onSession, onOpen, onToggle, onSectionDone, onSectionSkip, showThumb, startBottom = 'bottom-0' }: HepChecklistProps) {
  const [skipping, setSkipping] = useState<string | null>(null);
  const mine = itemsInSession(items, logs, today, session);
  const sections = sectionsOf(mine);
  const next = nextToDo(mine, logs, today, session);
  const anyDone = mine.some((i) => statusOf(i, logs, today, session) !== 'open');
  const label = sessionLabel(sessionCount, session);

  return (
    <div className="space-y-4">
      {sessionCount > 1 && (
        <div role="group" aria-label="Session" className="flex gap-1 rounded-full bg-slate-200 p-1">
          {Array.from({ length: sessionCount }, (_, i) => i + 1).map((s) => {
            const open = itemsInSession(items, logs, today, s).filter((i) => !i.optional);
            const doneCount = open.filter((i) => statusOf(i, logs, today, s) !== 'open').length;
            const finished = open.length > 0 && doneCount === open.length;
            return (
              <button key={s} type="button" aria-pressed={session === s} onClick={() => onSession(s)} className={`min-h-11 flex-1 rounded-full px-3 text-base font-semibold ${session === s ? 'bg-white text-teal-900 shadow' : 'text-slate-700'}`}>
                {sessionLabel(sessionCount, s)} {finished ? '✓' : `${doneCount}/${open.length}`}
              </button>
            );
          })}
        </div>
      )}

      {sections.map((section) => {
        const required = section.items.filter((i) => !i.optional);
        const doneCount = required.filter((i) => statusOf(i, logs, today, session) !== 'open').length;
        const open = section.items.filter((i) => statusOf(i, logs, today, session) === 'open');
        return (
          <section key={section.phase} aria-label={section.title} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <h2 className="min-w-0 flex-1 text-lg font-bold text-slate-900">
                {section.title} <span className="text-base font-medium text-slate-500">{sectionLabelCount(required.length, doneCount)}</span>
              </h2>
              {open.length >= 2 && (
                <>
                  <button type="button" onClick={() => { setSkipping(null); onSectionDone(open); }} className="min-h-11 rounded-full border border-teal-700 px-4 text-base font-semibold text-teal-800">All done</button>
                  <button type="button" aria-expanded={skipping === section.phase} onClick={() => setSkipping(skipping === section.phase ? null : section.phase)} className="min-h-11 rounded-full px-3 text-base font-semibold text-slate-700">Skip ›</button>
                </>
              )}
            </header>
            {skipping === section.phase && (
              <div className="border-b border-slate-100 px-3 py-2">
                <p className="mb-2 text-base text-slate-700">Why are you skipping {section.title.toLowerCase()}?</p>
                <div className="flex flex-wrap gap-2">
                  {SECTION_REASONS.map((r) => (
                    <button key={r.value} type="button" onClick={() => { setSkipping(null); onSectionSkip(open, r.value); }} className="min-h-11 rounded-full border border-slate-300 bg-white px-4 text-base">{r.label}</button>
                  ))}
                </div>
              </div>
            )}
            <ul>
              {section.items.map((item) => {
                const status = statusOf(item, logs, today, session);
                const state = status === 'none' ? 'open' : status;
                return (
                  <li key={item.id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0">
                    <Tick status={state} title={item.title} onClick={() => onToggle(item)} />
                    <button type="button" onClick={() => onOpen(item)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Open ${item.title}`}>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-base font-semibold leading-snug ${state === 'done' ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                          {item.title}
                          {item.optional && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-sm font-medium text-slate-600 no-underline">Optional</span>}
                          {state === 'skipped' && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-sm font-medium text-slate-600">Skipped</span>}
                        </span>
                        <span className="block text-sm text-slate-600">{shortDose(item)}</span>
                      </span>
                      {item.mediaUrls[0] && !item.hidePicturesInLists && (showThumb?.(item) ?? true) && (
                        <img src={item.mediaUrls[0]} alt="" loading="lazy" className="order-first h-12 w-16 shrink-0 rounded-lg bg-slate-100 object-cover" />
                      )}
                      <span aria-hidden className="shrink-0 text-2xl text-slate-400">›</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {next ? (
        <button type="button" onClick={() => onOpen(next)} className={`sticky ${startBottom} z-10 min-h-14 w-full rounded-full bg-teal-700 px-6 text-lg font-bold text-white shadow`}>
          ▶ {anyDone ? 'Continue' : 'Start'}: {next.title}
        </button>
      ) : (
        mine.length > 0 && <p className="rounded-2xl bg-teal-50 px-4 py-3 text-center text-lg font-bold text-teal-900">{label ? `${label} done ✓` : 'All done for today ✓'}</p>
      )}
    </div>
  );
}
