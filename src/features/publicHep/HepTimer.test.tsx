// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHoldPhases, buildTimedPhases, type TimerPhase } from '@/domain/hepTimers';
import { HepTimerLayer, useHepTimer } from './HepTimer';
import { createHepSound, type SoundMode, type TimerSound } from './hepSound';

const fakeSound = (): TimerSound => ({ unlock: vi.fn(), cue: vi.fn(), tick: vi.fn(), stop: vi.fn() });
const kinds = (sound: TimerSound) => (sound.cue as ReturnType<typeof vi.fn>).mock.calls.map(([p]) => (p === 'done' ? 'done' : (p as TimerPhase).kind));

describe('the helper timer', () => {
  beforeEach(() => { vi.useFakeTimers({ now: 1_000_000 }); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('Start 10 holds runs Get into position, Hold, Relax, Back to position, and no Back after the last rep', () => {
    const sound = fakeSound();
    const { result } = renderHook(() => useHepTimer(sound));
    act(() => result.current.start(buildHoldPhases(10, 5, false)));
    act(() => { vi.advanceTimersByTime(125_000); });
    const seen = kinds(sound);
    expect(seen.slice(0, 5)).toEqual(['ready', 'hold', 'relax', 'back', 'hold']);
    expect(seen.filter((k) => k === 'back')).toHaveLength(9);
    expect(seen.slice(-3)).toEqual(['hold', 'relax', 'done']);
    expect(result.current.running).toBe(false);
  });

  it('the remaining time comes from the phase end time, so a 20 s jump of the clock shows the right second', () => {
    const sound = fakeSound();
    const { result } = renderHook(() => useHepTimer(sound));
    act(() => result.current.start(buildHoldPhases(10, 5, false))); // ready 0-5, hold 5-10, relax 10-13, back 13-17, hold 17-22
    act(() => { vi.setSystemTime(Date.now() + 20_000); vi.advanceTimersByTime(250); });
    expect(result.current.view?.phase.kind).toBe('hold');
    expect(result.current.view?.phase.rep).toBe(2);
    expect(result.current.view?.remaining).toBe(2);
  });

  it('Skip on a short phase moves to the next phase at once', () => {
    const sound = fakeSound();
    const { result } = renderHook(() => useHepTimer(sound));
    act(() => result.current.start(buildTimedPhases(30, false)));
    expect(result.current.view?.phase.kind).toBe('ready');
    act(() => result.current.skip());
    expect(result.current.view?.phase.kind).toBe('work');
    expect(result.current.view?.remaining).toBe(30);
  });

  it('Stop ends the run and silences the voice', () => {
    const sound = fakeSound();
    const { result } = renderHook(() => useHepTimer(sound));
    act(() => result.current.start(buildTimedPhases(30, false)));
    act(() => result.current.stop());
    expect(result.current.running).toBe(false);
    expect(sound.stop).toHaveBeenCalled();
  });

  it('beeps on each of the last three seconds of a longer phase', () => {
    const sound = fakeSound();
    const { result } = renderHook(() => useHepTimer(sound));
    act(() => result.current.start(buildTimedPhases(30, false))); // ready is 5 s
    act(() => { vi.advanceTimersByTime(4_100); }); // 0.9 s left of the 5 s phase: seconds 3, 2 and 1 have each beeped once
    expect(sound.tick).toHaveBeenCalledTimes(3);
  });
});

describe('the timer layer', () => {
  afterEach(() => { cleanup(); });

  const view = (phase: TimerPhase, remaining = 4) => ({ phase, index: 0, total: 3, remaining });

  it('an each-side exercise shows "Now the other side" once and restarts rep numbers with "Side 2"', () => {
    const phases = buildHoldPhases(3, 5, true);
    expect(phases.filter((p) => p.kind === 'switch')).toHaveLength(1);
    expect(phases.filter((p) => p.kind === 'ready')).toHaveLength(1);
    const firstOfSide2 = phases.find((p) => p.side === 2 && p.kind === 'hold');
    expect(firstOfSide2?.rep).toBe(1);
    render(<HepTimerLayer view={view(firstOfSide2!)} repsTotal={3} onSkip={() => {}} onStop={() => {}} />);
    expect(screen.getByText('Side 2 · Rep 1 of 3')).toBeInTheDocument();
  });

  it('the Hold ring has no Skip, only Stop; the short phases have Skip', async () => {
    const onSkip = vi.fn();
    const { rerender } = render(<HepTimerLayer view={view({ kind: 'hold', label: 'Hold', seconds: 5, rep: 1 })} repsTotal={10} onSkip={onSkip} onStop={() => {}} />);
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByText('HOLD')).toBeInTheDocument();
    rerender(<HepTimerLayer view={view({ kind: 'relax', label: 'Relax', seconds: 3 }, 2)} repsTotal={10} onSkip={onSkip} onStop={() => {}} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Skip/ }));
    expect(onSkip).toHaveBeenCalled();
    expect(screen.getByText('Relax')).toBeInTheDocument();
  });
});

describe('the sound', () => {
  let speak: ReturnType<typeof vi.fn>;
  let oscillators: number;
  let contexts: number;

  beforeEach(() => {
    speak = vi.fn();
    oscillators = 0;
    contexts = 0;
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
    vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; constructor(public text: string) {} });
    vi.stubGlobal('AudioContext', class {
      state = 'running'; currentTime = 0; destination = {};
      constructor() { contexts += 1; }
      resume() { return Promise.resolve(); }
      createOscillator() { oscillators += 1; return { frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const hold: TimerPhase = { kind: 'hold', label: 'Hold', seconds: 5, rep: 1 };
  const play = (mode: SoundMode) => {
    const s = createHepSound(() => mode);
    s.unlock();
    s.cue(hold);
    return s;
  };

  it('speaks "Hold" when a hold starts with Sound = Voice', () => {
    play('voice');
    expect(speak).toHaveBeenCalledTimes(1);
    expect((speak.mock.calls[0][0] as { text: string }).text).toBe('Hold');
    expect(oscillators).toBe(0);
  });

  it('beeps with Sound = Beeps and does not speak', () => {
    play('beeps');
    expect(oscillators).toBe(1);
    expect(speak).not.toHaveBeenCalled();
  });

  it('is silent with Off', () => {
    play('off');
    expect(oscillators).toBe(0);
    expect(speak).not.toHaveBeenCalled();
  });

  it('makes one AudioContext however many times it is unlocked', () => {
    const s = createHepSound(() => 'beeps');
    s.unlock();
    s.unlock();
    s.cue(hold);
    s.cue(hold);
    expect(contexts).toBe(1);
  });
});
