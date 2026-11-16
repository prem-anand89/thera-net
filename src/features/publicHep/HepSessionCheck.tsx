// "How did this session feel?": a Pain | Effort switch, eleven large 0 to 10 buttons with words, and chips for the
// exercises that hurt or were hardest (amendment 53). Both sides are optional, both can be filled, and "Not now" is always there.
import { useEffect, useRef, useState } from 'react';
import type { PublicHepItem } from '@/services/publicHepService';
import { effortWords, painWords } from './hepSession';

export interface SessionCheckValues {
  pain: number | null;
  effort: number | null;
  painItemIds: string[];
  hardItemIds: string[];
}

export interface HepSessionCheckProps {
  /** The exercises of the session being rated. */
  items: PublicHepItem[];
  /** Which side opens first (the program's "Ask about" setting). */
  defaultSide: 'pain' | 'effort';
  initial?: Partial<SessionCheckValues>;
  clinicPhone: string | null;
  sessionName?: string;
  onSave: (values: SessionCheckValues) => Promise<void>;
  onNotNow: () => void;
}

const SCALE = Array.from({ length: 11 }, (_, i) => i);

export function HepSessionCheck({ items, defaultSide, initial, clinicPhone, sessionName, onSave, onNotNow }: HepSessionCheckProps) {
  const [side, setSide] = useState<'pain' | 'effort'>(defaultSide);
  const [pain, setPain] = useState<number | null>(initial?.pain ?? null);
  const [effort, setEffort] = useState<number | null>(initial?.effort ?? null);
  const [painItemIds, setPainItemIds] = useState<string[]>(initial?.painItemIds ?? []);
  const [hardItemIds, setHardItemIds] = useState<string[]>(initial?.hardItemIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const value = side === 'pain' ? pain : effort;
  const setValue = side === 'pain' ? setPain : setEffort;
  const marked = side === 'pain' ? painItemIds : hardItemIds;
  const setMarked = side === 'pain' ? setPainItemIds : setHardItemIds;
  const toggle = (id: string) => setMarked(marked.includes(id) ? marked.filter((x) => x !== id) : [...marked, id]);
  const words = value === null ? '' : side === 'pain' ? painWords(value) : effortWords(value);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave({ pain, effort, painItemIds: pain === null ? [] : painItemIds, hardItemIds: effort === null ? [] : hardItemIds });
    } catch {
      setError('Could not save this. Check your connection and try again.');
      setBusy(false);
    }
  }

  const tab = (key: 'pain' | 'effort', label: string) => (
    <button type="button" aria-pressed={side === key} onClick={() => setSide(key)} className={`min-h-11 flex-1 rounded-full px-4 text-base font-semibold ${side === key ? 'bg-teal-700 text-white' : 'text-slate-700'}`}>{label}</button>
  );

  return (
    <section ref={sectionRef} aria-label="How did this session feel?" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-slate-900 outline-none">How did {sessionName ? `${sessionName.toLowerCase()} ` : 'this '}session feel?</h2>
        <p className="text-base text-slate-600">Optional. It helps your therapist plan your next steps.</p>
      </div>

      <div role="group" aria-label="What to rate" className="flex gap-1 rounded-full bg-slate-100 p-1">
        {tab('pain', 'Pain')}
        {tab('effort', 'Effort')}
      </div>

      <div>
        <div role="group" aria-label={side === 'pain' ? 'Pain from 0 to 10' : 'Effort from 0 to 10'} className="grid grid-cols-6 gap-2 sm:grid-cols-11">
          {SCALE.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={value === n}
              aria-label={String(n)}
              onClick={() => setValue(value === n ? null : n)}
              className={`min-h-11 rounded-xl border text-lg font-bold tabular-nums ${value === n ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-800'}`}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="mt-2 min-h-6 text-base font-semibold text-slate-800" aria-live="polite">{words}</p>
        {side === 'pain' && <p className="text-base text-slate-600">Mild discomfort is okay. If it feels sharp or gets worse, stop and let us know.</p>}
        {side === 'pain' && pain !== null && pain >= 7 && (
          <div className="mt-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-base text-rose-950">
            <p className="font-semibold">Please contact the clinic if this continues.</p>
            {clinicPhone && <a href={`tel:${clinicPhone.replace(/\s+/g, '')}`} className="mt-2 inline-flex min-h-11 items-center rounded-full bg-rose-700 px-5 font-semibold text-white">Call the clinic</a>}
          </div>
        )}
      </div>

      {value !== null && items.length > 0 && (
        <div>
          <p className="mb-2 text-base font-semibold text-slate-800">{side === 'pain' ? 'Which exercise hurt?' : 'Which was the hardest?'}</p>
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <button key={item.id} type="button" aria-pressed={marked.includes(item.id)} onClick={() => toggle(item.id)} className={`min-h-11 rounded-full border px-4 text-base ${marked.includes(item.id) ? 'border-teal-700 bg-teal-50 font-semibold text-teal-900' : 'border-slate-300 bg-white text-slate-800'}`}>
                {item.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-base text-rose-700">{error}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onNotNow} disabled={busy} className="min-h-12 flex-1 rounded-full border border-slate-300 px-4 text-base font-semibold text-slate-700">Not now</button>
        <button type="button" onClick={() => void save()} disabled={busy || (pain === null && effort === null)} className="min-h-12 flex-1 rounded-full bg-teal-700 px-4 text-base font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </section>
  );
}
