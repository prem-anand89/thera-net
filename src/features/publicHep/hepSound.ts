// Sound for the helper timers: spoken cues (the phone's own voice), beeps, or nothing. One AudioContext, made on the Start
// tap (a user gesture) and reused. Everything is wrapped in try/catch because phones may block audio, speech and vibration.
import { TIMER_PHASE_CUES, type TimerPhase } from '@/domain/hepTimers';

export type SoundMode = 'voice' | 'beeps' | 'off';

export interface TimerSound {
  /** Call from the Start tap. */
  unlock(): void;
  /** A phase has just begun, or the whole run is done. */
  cue(phase: TimerPhase | 'done'): void;
  /** One of the last three seconds of a phase. */
  tick(): void;
  /** Silence anything still speaking. */
  stop(): void;
}

const STORE_KEY = 'hep-sound';

export const hasVoice = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function readSoundMode(): SoundMode {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'voice' || saved === 'beeps' || saved === 'off') return saved === 'voice' && !hasVoice() ? 'beeps' : saved;
  } catch {
    /* storage blocked */
  }
  return hasVoice() ? 'voice' : 'beeps';
}

export function saveSoundMode(mode: SoundMode): void {
  try {
    localStorage.setItem(STORE_KEY, mode);
  } catch {
    /* storage blocked */
  }
}

export const nextSoundMode = (mode: SoundMode): SoundMode => (mode === 'voice' ? 'beeps' : mode === 'beeps' ? 'off' : hasVoice() ? 'voice' : 'beeps');

export const SOUND_LABELS: Record<SoundMode, string> = { voice: 'Voice', beeps: 'Beeps', off: 'Sound off' };

/** The real sound player. `getMode` is read on every cue so a switch takes effect at once. */
export function createHepSound(getMode: () => SoundMode): TimerSound {
  let ctx: AudioContext | null = null;

  const beep = (frequency: number, seconds: number, volume: number) => {
    try {
      if (!ctx) return;
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + seconds);
    } catch {
      /* audio blocked */
    }
  };
  const buzz = (ms: number) => {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* vibration blocked */
    }
  };
  const speak = (text: string) => {
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en';
      synth.speak(utterance);
    } catch {
      /* speech blocked */
    }
  };

  return {
    unlock() {
      try {
        if (!ctx) {
          const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctor) ctx = new Ctor();
        }
        if (ctx?.state === 'suspended') void ctx.resume();
      } catch {
        /* audio blocked */
      }
    },
    cue(phase) {
      const mode = getMode();
      if (mode === 'off') return;
      const strong = phase === 'done' || phase.kind === 'hold' || phase.kind === 'work';
      buzz(strong ? 200 : 80);
      if (mode === 'voice') speak(phase === 'done' ? 'Done' : TIMER_PHASE_CUES[phase.kind]);
      else beep(strong ? 880 : 660, strong ? 0.5 : 0.25, strong ? 0.35 : 0.2);
    },
    tick() {
      if (getMode() === 'beeps') beep(520, 0.12, 0.12);
    },
    stop() {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* speech blocked */
      }
    },
  };
}
