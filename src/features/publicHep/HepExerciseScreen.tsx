// One exercise per screen (amendment 82): the picture with the timer over it, the dose in one line, Start / Rest,
// the steps (open the first time, then collapsed), the Stop-if line, and a fixed bar with Skip and ✓ Done · Next ›.
// "Preview as patient" renders this same screen read-only.
import { useMemo, useRef, useState } from 'react';
import type { SkipReason } from '@/domain/hep';
import { buildHoldPhases, buildRestPhases, buildTimedPhases } from '@/domain/hepTimers';
import type { PublicHepItem } from '@/services/publicHepService';
import { HepTimerLayer, useHepTimer } from './HepTimer';
import { SOUND_LABELS, type SoundMode, type TimerSound } from './hepSound';
import { SKIP_REASONS, doseInWords, doseNotes, stepsOf, type SessionStatus } from './hepSession';

export interface HepExerciseScreenProps {
  item: PublicHepItem;
  /** "2 of 4" within the session. */
  position: number;
  total: number;
  session: number;
  sessionCount: number;
  status: SessionStatus;
  skipReason?: SkipReason | null;
  /** First time the patient opens this exercise: the steps start open. */
  firstVisit: boolean;
  soundMode: SoundMode;
  sound: TimerSound;
  onSoundMode: () => void;
  onBack: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onDone: () => void;
  onSkip: (reason: SkipReason) => void;
  onUndo: () => void;
  onImageError: () => void;
  /** Preview as patient: the buttons that change data are hidden. */
  readOnly?: boolean;
}

function Picture({ item, onImageError }: { item: PublicHepItem; onImageError: () => void }) {
  const [at, setAt] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  if (item.mediaType === 'none' || item.mediaUrls.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-teal-50 p-6 text-center">
        <p className="text-2xl font-bold text-teal-900">{item.title}</p>
      </div>
    );
  }
  if (item.mediaType === 'gif' || item.mediaUrls.length === 1) {
    return <img src={item.mediaUrls[0]} alt={item.mediaCaptions[0] || item.title} onError={onImageError} className="h-full w-full object-contain" />;
  }
  return (
    <div className="relative h-full w-full">
      <div
        ref={strip}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {item.mediaUrls.map((url, i) => (
          <figure key={url} className="relative h-full w-full shrink-0 snap-center">
            <img src={url} alt={item.mediaCaptions[i] || `${item.title}, picture ${i + 1}`} onError={onImageError} className="h-full w-full object-contain" />
            {item.mediaCaptions[i] && <figcaption className="absolute inset-x-0 top-0 bg-black/55 px-3 py-1 text-center text-base text-white">{item.mediaCaptions[i]}</figcaption>}
          </figure>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden>
        {item.mediaUrls.map((url, i) => (
          <span key={url} className={`h-2 w-2 rounded-full ${i === at ? 'bg-teal-600' : 'bg-white/80 ring-1 ring-slate-400'}`} />
        ))}
      </div>
    </div>
  );
}

export function HepExerciseScreen(p: HepExerciseScreenProps) {
  const { item } = p;
  const [stepsOpen, setStepsOpen] = useState(p.firstVisit);
  const [asking, setAsking] = useState(false);
  const timer = useHepTimer(p.sound);
  const steps = useMemo(() => stepsOf(item.instructions), [item.instructions]);
  const eachSide = item.side === 'both';
  const notes = doseNotes(item, p.sessionCount, p.session);
  const done = p.status === 'done';
  const skipped = p.status === 'skipped';

  const starts: Array<{ label: string; phases: ReturnType<typeof buildHoldPhases> }> = [];
  if (item.doseType === 'hold') starts.push({ label: `Start ${item.reps ?? 1} holds`, phases: buildHoldPhases(item.reps ?? 1, item.holdSeconds ?? 1, eachSide) });
  if (item.doseType === 'timed') starts.push({ label: `Start ${item.durationSeconds ?? 1} s`, phases: buildTimedPhases(item.durationSeconds ?? 1, eachSide) });
  if (item.restSeconds > 0) starts.push({ label: `Rest ${item.restSeconds} s`, phases: buildRestPhases(item.restSeconds) });

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-slate-50 text-slate-900">
      <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-2 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={() => { timer.stop(); p.onBack(); }} className="min-h-11 px-3 text-base font-semibold text-teal-800">‹ List</button>
        <p className="flex-1 text-center text-base font-medium text-slate-600">{p.position} of {p.total}</p>
        <button type="button" onClick={() => { timer.stop(); p.onPrev?.(); }} disabled={!p.onPrev} aria-label="Previous exercise" className="min-h-11 min-w-11 text-2xl text-slate-700 disabled:opacity-30">‹</button>
        <button type="button" onClick={() => { timer.stop(); p.onNext?.(); }} disabled={!p.onNext} aria-label="Next exercise" className="min-h-11 min-w-11 text-2xl text-slate-700 disabled:opacity-30">›</button>
        <button type="button" onClick={p.onSoundMode} aria-label={`Sound: ${SOUND_LABELS[p.soundMode]}. Tap to change.`} className="min-h-11 min-w-11 px-2 text-sm font-semibold text-slate-700">
          {p.soundMode === 'voice' ? '🔊 Voice' : p.soundMode === 'beeps' ? '🔔 Beeps' : '🔇 Off'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-40">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-white">
          <Picture item={item} onImageError={p.onImageError} />
          {timer.view && <HepTimerLayer view={timer.view} repsTotal={item.doseType === 'hold' ? item.reps : null} onSkip={timer.skip} onStop={timer.stop} />}
        </div>

        <div className="mx-auto max-w-xl space-y-4 px-4 py-4">
          <div>
            <h1 className="text-2xl font-bold leading-tight">
              {item.title}
              {item.optional && <span className="ml-2 align-middle rounded-full bg-slate-100 px-2 py-0.5 text-sm font-medium text-slate-600">Optional</span>}
            </h1>
            <p className="mt-1 text-lg font-semibold text-slate-800">{doseInWords(item)}</p>
            {notes && <p className="text-base text-slate-600">{notes}</p>}
          </div>

          {!p.readOnly && starts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {timer.running ? (
                <button type="button" onClick={timer.stop} className="min-h-12 flex-1 rounded-full border-2 border-rose-600 px-5 text-lg font-semibold text-rose-700">Stop</button>
              ) : (
                starts.map((s) => (
                  <button key={s.label} type="button" onClick={() => timer.start(s.phases)} className="min-h-12 flex-1 rounded-full bg-slate-900 px-5 text-lg font-semibold text-white">{s.label}</button>
                ))
              )}
            </div>
          )}

          {steps.length > 0 && (
            <section aria-label="How to do it" className="rounded-2xl border border-slate-200 bg-white p-4">
              <button type="button" onClick={() => setStepsOpen((v) => !v)} aria-expanded={stepsOpen} className="flex min-h-11 w-full items-center justify-between text-left text-lg font-bold">
                How to do it <span aria-hidden>{stepsOpen ? '▴' : '▾'}</span>
              </button>
              {stepsOpen ? (
                <ol className="mt-2 list-decimal space-y-2 pl-6 text-[1.125rem] leading-relaxed">
                  {steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              ) : (
                <p className="mt-1 text-[1.125rem] leading-relaxed text-slate-700">1. {steps[0]}</p>
              )}
            </section>
          )}

          {item.specialInstructions && (
            <p className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-[1.125rem] leading-relaxed text-teal-950"><span className="font-bold">From your therapist: </span>{item.specialInstructions}</p>
          )}
          {item.stopIf && (
            <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-[1.125rem] leading-relaxed text-amber-950"><span className="font-bold">⚠ Stop if: </span>{item.stopIf}</p>
          )}
        </div>
      </div>

      {!p.readOnly && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          {asking && (
            <div className="mb-3">
              <p className="mb-2 text-base font-semibold">Why are you skipping this?</p>
              <div className="flex flex-wrap gap-2">
                {SKIP_REASONS.map((r) => (
                  <button key={r.value} type="button" onClick={() => { setAsking(false); timer.stop(); p.onSkip(r.value); }} className="min-h-11 rounded-full border border-slate-300 bg-white px-4 text-base">{r.label}</button>
                ))}
              </div>
            </div>
          )}
          {done || skipped ? (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-base font-semibold text-slate-700">{done ? '✓ Done' : `Skipped${p.skipReason ? ` (${SKIP_REASONS.find((r) => r.value === p.skipReason)?.label.toLowerCase() ?? ''})` : ''}`}</p>
              <button type="button" onClick={p.onUndo} className="min-h-12 rounded-full border border-slate-300 px-5 text-base font-semibold">Undo</button>
              {p.onNext && <button type="button" onClick={() => { timer.stop(); p.onNext?.(); }} className="min-h-12 rounded-full bg-teal-700 px-6 text-base font-semibold text-white">Next ›</button>}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setAsking((v) => !v)} aria-expanded={asking} className="min-h-12 rounded-full border border-slate-300 px-6 text-base font-semibold text-slate-800">Skip</button>
              <button type="button" onClick={() => { timer.stop(); p.onDone(); }} className="min-h-12 flex-1 rounded-full bg-teal-700 px-6 text-lg font-bold text-white">✓ Done · Next ›</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
