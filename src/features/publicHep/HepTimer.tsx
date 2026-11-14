// The helper timer: a hook that walks a list of phases by END TIME (a phone slows timers when the screen locks, so the
// display is recomputed from the clock about four times a second), and the layer drawn over the exercise picture.
// Hold and Go get the big ring over the picture; the short phases are a tinted band along the bottom with Skip.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimerPhase } from '@/domain/hepTimers';
import type { TimerSound } from './hepSound';

export interface TimerView {
  phase: TimerPhase;
  index: number;
  total: number;
  /** Whole seconds left in this phase, rounded up. */
  remaining: number;
}

const TICK_MS = 250;

export function useHepTimer(sound: TimerSound) {
  const run = useRef<{ phases: TimerPhase[]; index: number; endAt: number; lastBeep: number } | null>(null);
  const [view, setView] = useState<TimerView | null>(null);
  const running = view !== null;
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  const releaseWake = () => {
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  };

  const publish = useCallback((now: number) => {
    const r = run.current;
    if (!r) {
      setView(null);
      return;
    }
    const remaining = Math.max(0, Math.ceil((r.endAt - now) / 1000));
    setView((cur) => (cur && cur.index === r.index && cur.remaining === remaining && cur.total === r.phases.length ? cur : { phase: r.phases[r.index], index: r.index, total: r.phases.length, remaining }));
  }, []);

  const finish = useCallback(() => {
    run.current = null;
    setView(null);
    releaseWake();
    sound.cue('done');
  }, [sound]);

  const tick = useCallback(() => {
    const r = run.current;
    if (!r) return;
    const now = Date.now();
    let moved = false;
    // Chained from the previous end time, so a jump of the clock lands in the right phase.
    while (now >= r.endAt) {
      if (r.index + 1 >= r.phases.length) {
        finish();
        return;
      }
      r.index += 1;
      r.endAt += r.phases[r.index].seconds * 1000;
      r.lastBeep = 0;
      moved = true;
    }
    if (moved) sound.cue(r.phases[r.index]);
    const remaining = Math.ceil((r.endAt - now) / 1000);
    if (remaining >= 1 && remaining <= 3 && r.phases[r.index].seconds > 3 && r.lastBeep !== remaining) {
      r.lastBeep = remaining;
      sound.tick();
    }
    publish(now);
  }, [finish, publish, sound]);

  const start = useCallback(
    (phases: TimerPhase[]) => {
      if (phases.length === 0) return;
      sound.unlock();
      const now = Date.now();
      run.current = { phases, index: 0, endAt: now + phases[0].seconds * 1000, lastBeep: 0 };
      sound.cue(phases[0]);
      publish(now);
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
        void nav.wakeLock?.request('screen').then((lock) => { wakeLock.current = lock; }).catch(() => {});
      } catch {
        /* wake lock blocked */
      }
    },
    [publish, sound],
  );

  const stop = useCallback(() => {
    run.current = null;
    setView(null);
    sound.stop();
    releaseWake();
  }, [sound]);

  /** Ends the current short phase now. */
  const skip = useCallback(() => {
    const r = run.current;
    if (!r) return;
    r.endAt = Date.now();
    tick();
  }, [tick]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [running, tick]);

  // Leaving the screen or the page stops the timer.
  useEffect(() => () => {
    run.current = null;
    sound.stop();
    releaseWake();
  }, [sound]);

  return { view, running, start, stop, skip };
}

const RING_R = 54;
const RING_LENGTH = 2 * Math.PI * RING_R;

const BAND: Record<string, { bg: string; hint: string }> = {
  ready: { bg: 'bg-amber-100 text-amber-950', hint: 'Settle into the starting position.' },
  back: { bg: 'bg-amber-100 text-amber-950', hint: 'Return to the starting position.' },
  switch: { bg: 'bg-amber-100 text-amber-950', hint: 'Change sides and get ready.' },
  relax: { bg: 'bg-sky-100 text-sky-950', hint: 'Let go and breathe.' },
  rest: { bg: 'bg-sky-100 text-sky-950', hint: 'Shake it out before the next set.' },
};

/** "Side 2 · Rep 3 of 10" (the parts that apply). */
export function phaseSubtitle(phase: TimerPhase, repsTotal: number | null): string {
  const parts: string[] = [];
  if (phase.side) parts.push(`Side ${phase.side}`);
  if (phase.rep && repsTotal) parts.push(`Rep ${phase.rep} of ${repsTotal}`);
  return parts.join(' · ');
}

export function HepTimerLayer({ view, repsTotal, onSkip, onStop }: { view: TimerView; repsTotal: number | null; onSkip: () => void; onStop: () => void }) {
  const { phase, remaining } = view;
  const big = phase.kind === 'hold' || phase.kind === 'work';
  const subtitle = phaseSubtitle(phase, repsTotal);
  if (big) {
    const fraction = phase.seconds > 0 ? Math.min(1, Math.max(0, remaining / phase.seconds)) : 0;
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-900/70 text-white" role="timer" aria-label={`${phase.label}, ${remaining} seconds`}>
        <div className="relative h-40 w-40">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
            <circle cx="60" cy="60" r={RING_R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="8" />
            <circle cx="60" cy="60" r={RING_R} fill="none" stroke="#5eead4" strokeWidth="8" strokeLinecap="round" strokeDasharray={RING_LENGTH} strokeDashoffset={RING_LENGTH * (1 - fraction)} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-sm font-bold tracking-widest">{phase.kind === 'hold' ? 'HOLD' : 'GO'}</span>
            <span className="text-[3.25rem] font-bold leading-none tabular-nums">{remaining}</span>
          </div>
        </div>
        {subtitle && <p className="text-base font-medium">{subtitle}</p>}
        <button type="button" onClick={onStop} className="mt-2 min-h-11 rounded-full border border-white/60 px-5 text-base font-semibold text-white">Stop</button>
      </div>
    );
  }
  const band = BAND[phase.kind] ?? BAND.relax;
  return (
    <div className={`absolute inset-x-0 bottom-0 flex items-center gap-3 px-3 py-2 ${band.bg}`} role="timer" aria-label={`${phase.label}, ${remaining} seconds`}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/70 text-xl font-bold tabular-nums">{remaining}</span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold leading-tight">{phase.label}</p>
        <p className="text-sm leading-tight">{[subtitle, band.hint].filter(Boolean).join(' · ')}</p>
      </div>
      <button type="button" onClick={onSkip} className="min-h-11 shrink-0 rounded-full bg-white/80 px-4 text-base font-semibold">Skip ›</button>
      <button type="button" onClick={onStop} className="min-h-11 shrink-0 px-2 text-base font-semibold underline">Stop</button>
    </div>
  );
}
