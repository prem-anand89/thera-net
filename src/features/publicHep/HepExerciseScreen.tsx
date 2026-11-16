// One exercise per screen (amendment 82): the picture (only when the exercise has pictures; "Hide pictures in lists" never
// hides them here) with the timer band right under it, Sets / Reps / Hold boxes, Start / Rest, set circles to tick off
// each set (local to this visit of the screen: not logged, not saved), the steps (open the first time, then collapsed),
// the therapist's note, the Stop-if line, and a fixed bar with Skip and ✓ Done · Next ›.
// "Preview as patient" renders this same screen read-only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  /** Completed sets for this item today (held in memory by parent). Uncontrolled when omitted. */
  setsDone?: number;
  onSetsDoneChange?: (done: number) => void;
  /** Preview as patient: the buttons that change data are hidden. */
  readOnly?: boolean;
  /** Fill the nearest positioned parent (a phone frame) instead of the whole window. */
  framed?: boolean;
}

function Picture({ item, onImageError, onZoom }: { item: PublicHepItem; onImageError: () => void; onZoom: (index: number) => void }) {
  const [at, setAt] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  if (item.mediaType === 'gif' || item.mediaUrls.length === 1) {
    const label = item.mediaCaptions[0] || item.title;
    return (
      <button type="button" onClick={() => onZoom(0)} aria-label={`Zoom ${label}`} className="block h-full w-full cursor-zoom-in">
        <img src={item.mediaUrls[0]} alt={label} onError={onImageError} className="h-full w-full object-contain" />
      </button>
    );
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
        {item.mediaUrls.map((url, i) => {
          const label = item.mediaCaptions[i] || `${item.title}, picture ${i + 1}`;
          return (
            <figure key={url} className="relative h-full w-full shrink-0 snap-center">
              <button type="button" onClick={() => onZoom(i)} aria-label={`Zoom ${label}`} className="block h-full w-full cursor-zoom-in">
                <img src={url} alt={label} onError={onImageError} className="h-full w-full object-contain" />
              </button>
              {item.mediaCaptions[i] && <figcaption className="pointer-events-none absolute inset-x-0 top-0 bg-black/55 px-3 py-1 text-center text-base text-white">{item.mediaCaptions[i]}</figcaption>}
            </figure>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden>
        {item.mediaUrls.map((url, i) => (
          <span key={url} className={`h-2 w-2 rounded-full ${i === at ? 'bg-teal-600' : 'bg-white/80 ring-1 ring-slate-400'}`} />
        ))}
      </div>
    </div>
  );
}

function PhotoLightbox({
  item,
  index,
  place,
  onIndex,
  onClose,
  onImageError,
}: {
  item: PublicHepItem;
  index: number;
  place: 'absolute' | 'fixed';
  onIndex: (next: number) => void;
  onClose: () => void;
  onImageError: () => void;
}) {
  const total = item.mediaUrls.length;
  const swipeX = useRef<number | null>(null);
  const lastTouchTap = useRef(0);
  const skipDblClickUntil = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    setZoomed(false);
  }, [index]);

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeBtn.current?.focus();
    return () => {
      trigger?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight' && index < total - 1) onIndex(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'Tab') {
        const focusables = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        if (focusables.length === 0) return;
        e.preventDefault();
        const cur = focusables.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey
          ? (cur <= 0 ? focusables.length - 1 : cur - 1)
          : (cur + 1) % focusables.length;
        focusables[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, total, onClose, onIndex]);

  const caption = item.mediaCaptions[index] || '';
  const stageTouchAction = zoomed ? 'pan-x pan-y pinch-zoom' : 'pinch-zoom';
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Full screen picture"
      className={`${place} inset-0 z-50 flex flex-col bg-black/95 text-white`}
    >
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span className="text-base font-medium text-white/80">{total > 1 ? `${index + 1} of ${total}` : item.title}</span>
        <button
          ref={closeBtn}
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-full bg-white/15 px-4 text-base font-semibold text-white hover:bg-white/25"
        >
          Close
        </button>
      </div>
      <div
        className={`relative flex min-h-0 flex-1 overflow-auto px-3 py-2 ${zoomed ? 'items-start justify-start' : 'items-center justify-center'}`}
        style={{ touchAction: stageTouchAction }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          swipeX.current = e.clientX;
        }}
        onPointerUp={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          const startX = swipeX.current;
          swipeX.current = null;
          const dx = startX == null ? 0 : e.clientX - startX;
          if (!zoomed && total > 1 && startX != null) {
            if (dx <= -40 && index < total - 1) { onIndex(index + 1); return; }
            if (dx >= 40 && index > 0) { onIndex(index - 1); return; }
          }
          if (e.pointerType === 'touch' && Math.abs(dx) < 15) {
            const now = Date.now();
            if (now - lastTouchTap.current < 300) {
              lastTouchTap.current = 0;
              skipDblClickUntil.current = now + 400;
              setZoomed((z) => !z);
            } else {
              lastTouchTap.current = now;
            }
          }
        }}
      >
        <img
          src={item.mediaUrls[index]}
          alt={caption || (total > 1 ? `${item.title}, picture ${index + 1}` : item.title)}
          onError={onImageError}
          onDoubleClick={() => {
            if (Date.now() < skipDblClickUntil.current) {
              skipDblClickUntil.current = 0;
              return;
            }
            setZoomed((z) => !z);
          }}
          style={{ touchAction: stageTouchAction }}
          className={
            zoomed
              ? 'h-[200%] w-[200%] max-w-none shrink-0 object-contain cursor-zoom-out'
              : 'max-h-full max-w-full object-contain cursor-zoom-in'
          }
        />
        {total > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous picture"
              disabled={index === 0}
              onClick={() => onIndex(index - 1)}
              className="absolute left-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-2xl text-white disabled:opacity-25"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next picture"
              disabled={index === total - 1}
              onClick={() => onIndex(index + 1)}
              className="absolute right-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-2xl text-white disabled:opacity-25"
            >
              ›
            </button>
          </>
        )}
      </div>
      {caption && <p className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-center text-base text-white/90">{caption}</p>}
    </div>
  );
}

const hasPictures = (item: PublicHepItem) => item.mediaUrls.length > 0;

/** Sets, Reps (or seconds), and Hold or Rest boxes; the group's name is the dose in words for screen readers. */
function DoseBoxes({ item }: { item: PublicHepItem }) {
  const timed = item.doseType === 'timed';
  const hold = item.doseType === 'hold';
  const boxes: Array<[string, string]> = [
    [String(item.sets), item.sets === 1 ? 'set' : 'sets'],
    timed ? [`${item.durationSeconds ?? 0} s`, 'each'] : [String(item.reps ?? 0), item.reps === 1 ? 'rep' : 'reps'],
  ];
  if (hold) {
    boxes.push([`${item.holdSeconds ?? 0} s`, 'hold']);
  } else if (item.restSeconds > 0) {
    boxes.push([`${item.restSeconds} s`, 'rest']);
  }
  return (
    <div role="group" aria-label={doseInWords(item)} className={`grid gap-2 ${boxes.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
      {boxes.map(([value, label], i) => (
        <div key={i} className="rounded-xl bg-white px-2 py-2 text-center ring-1 ring-slate-200">
          <span className="block text-2xl font-bold leading-tight">{value}</span>
          <span className="block text-sm text-slate-600">{label}</span>
        </div>
      ))}
    </div>
  );
}

/** One circle per set. Tapping set n marks sets 1..n; tapping the last marked one takes it back. Nothing is saved. */
function SetCircles({ sets, done, onChange }: { sets: number; done: number; onChange: (next: number) => void }) {
  const title = 'Sets · tap each one when done';
  return (
    <div>
      <p aria-hidden className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{title}</p>
      <div role="group" aria-label={title} className="flex flex-wrap gap-2">
        {Array.from({ length: sets }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Set ${n}`}
            aria-pressed={n <= done}
            onClick={() => onChange(done === n ? n - 1 : n)}
            className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-lg font-bold ${n <= done ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
          >
            {n <= done ? '✓' : n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function HepExerciseScreen(p: HepExerciseScreenProps) {
  const { item, onSetsDoneChange } = p;
  const [stepsOpen, setStepsOpen] = useState(p.firstVisit);
  const [asking, setAsking] = useState(false);
  const [localSetsDone, setLocalSetsDone] = useState(0);
  const [finishMessage, setFinishMessage] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);
  const setsDone = Math.max(0, Math.min(item.sets, p.setsDone ?? localSetsDone));
  const setsDoneRef = useRef(setsDone);
  setsDoneRef.current = setsDone;
  const setSetsDone = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(item.sets, next));
      setsDoneRef.current = clamped;
      if (onSetsDoneChange) onSetsDoneChange(clamped);
      else setLocalSetsDone(clamped);
    },
    [item.sets, onSetsDoneChange],
  );
  const startKind = useRef<'hold' | 'timed' | 'rest'>('hold');
  const setsAtRunStart = useRef(0);
  const onTimerFinish = useCallback(() => {
    if (startKind.current === 'rest') return;
    const current = setsDoneRef.current;
    const tickedDuringRun = current > setsAtRunStart.current;
    const next = tickedDuringRun ? current : Math.min(item.sets, current + 1);
    if (!tickedDuringRun) setSetsDone(next);
    if (next < item.sets) {
      const restPart = item.restSeconds > 0 ? ` Rest ${item.restSeconds} s, then start set ${next + 1}.` : ` Start set ${next + 1}.`;
      setFinishMessage(`Set ${next} of ${item.sets} done.${restPart}`);
    } else {
      setFinishMessage("All sets done. Tap ✓ Done when you're ready.");
    }
  }, [item.sets, item.restSeconds, setSetsDone]);
  const timer = useHepTimer(p.sound, onTimerFinish);
  const steps = useMemo(() => stepsOf(item.instructions), [item.instructions]);
  const eachSide = item.side === 'both';
  const notes = doseNotes(item, p.sessionCount, p.session);
  const done = p.status === 'done';
  const skipped = p.status === 'skipped';

  const starts: Array<{ label: string; kind: 'hold' | 'timed' | 'rest'; phases: ReturnType<typeof buildHoldPhases> }> = [];
  if (item.doseType === 'hold') starts.push({ label: `Start ${item.reps ?? 1} holds`, kind: 'hold', phases: buildHoldPhases(item.reps ?? 1, item.holdSeconds ?? 1, eachSide) });
  if (item.doseType === 'timed') starts.push({ label: `Start ${item.durationSeconds ?? 1} s`, kind: 'timed', phases: buildTimedPhases(item.durationSeconds ?? 1, eachSide) });
  if (item.restSeconds > 0) starts.push({ label: `Rest ${item.restSeconds} s`, kind: 'rest', phases: buildRestPhases(item.restSeconds) });
  const finishedText = finishMessage;
  const place = p.framed ? 'absolute' : 'fixed';
  return (
    <div className={`${place} inset-0 z-30 flex flex-col bg-slate-50 text-slate-900`}>
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
        {hasPictures(item) && (
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-white">
            <Picture item={item} onImageError={p.onImageError} onZoom={setZoomIndex} />
          </div>
        )}
        {timer.view && <HepTimerLayer view={timer.view} repsTotal={item.doseType === 'hold' ? item.reps : null} onSkip={timer.skip} onStop={timer.stop} />}

        <div className="mx-auto max-w-xl space-y-4 px-4 py-4">
          <div>
            <h1 className="text-2xl font-bold leading-tight">
              {item.title}
              {item.optional && <span className="ml-2 align-middle rounded-full bg-slate-100 px-2 py-0.5 text-sm font-medium text-slate-600">Optional</span>}
            </h1>
            {notes && <p className="text-base text-slate-600">{notes}</p>}
          </div>

          <DoseBoxes item={item} />

          {!p.readOnly && starts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {timer.running ? (
                <button type="button" onClick={() => { setFinishMessage(null); timer.stop(); }} className="min-h-12 flex-1 rounded-full border-2 border-rose-600 px-5 text-lg font-semibold text-rose-700">Stop</button>
              ) : (
                starts.map((s) => (
                  <button key={s.label} type="button" onClick={() => { setFinishMessage(null); startKind.current = s.kind; setsAtRunStart.current = setsDoneRef.current; timer.start(s.phases); }} className="min-h-12 flex-1 rounded-full bg-slate-900 px-5 text-lg font-semibold text-white">{s.label}</button>
                ))
              )}
            </div>
          )}

          {item.sets > 1 && <SetCircles sets={item.sets} done={setsDone} onChange={setSetsDone} />}

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
        <div className={`${place} inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]`}>
          {finishedText && <p role="status" className="mb-3 rounded-2xl bg-teal-50 px-4 py-2 text-center text-base font-semibold text-teal-900">{finishedText}</p>}
          {asking && (
            <div className="mb-3">
              <p className="mb-2 text-base font-semibold">Why are you skipping this?</p>
              <div className="flex flex-wrap gap-2">
                {SKIP_REASONS.map((r) => (
                  <button key={r.value} type="button" onClick={() => { setAsking(false); setFinishMessage(null); timer.stop(); p.onSkip(r.value); }} className="min-h-11 rounded-full border border-slate-300 bg-white px-4 text-base">{r.label}</button>
                ))}
              </div>
            </div>
          )}
          {done || skipped ? (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-base font-semibold text-slate-700">{done ? '✓ Done' : `Skipped${p.skipReason ? ` (${SKIP_REASONS.find((r) => r.value === p.skipReason)?.label.toLowerCase() ?? ''})` : ''}`}</p>
              <button type="button" onClick={() => { setFinishMessage(null); timer.stop(); setSetsDone(0); p.onUndo(); }} className="min-h-12 rounded-full border border-slate-300 px-5 text-base font-semibold">Undo</button>
              {p.onNext && <button type="button" onClick={() => { setFinishMessage(null); timer.stop(); p.onNext?.(); }} className="min-h-12 rounded-full bg-teal-700 px-6 text-base font-semibold text-white">Next ›</button>}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setAsking((v) => !v)} aria-expanded={asking} className="min-h-12 rounded-full border border-slate-300 px-6 text-base font-semibold text-slate-800">Skip</button>
              <button type="button" onClick={() => { setFinishMessage(null); timer.stop(); p.onDone(); }} className="min-h-12 flex-1 rounded-full bg-teal-700 px-6 text-lg font-bold text-white">✓ Done · Next ›</button>
            </div>
          )}
        </div>
      )}
      {zoomIndex !== null && hasPictures(item) && (
        <PhotoLightbox
          item={item}
          index={Math.min(zoomIndex, item.mediaUrls.length - 1)}
          place={place}
          onIndex={setZoomIndex}
          onClose={() => setZoomIndex(null)}
          onImageError={p.onImageError}
        />
      )}
    </div>
  );
}
