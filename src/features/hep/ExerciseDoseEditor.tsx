// The dose lines every HEP editor shares: dosage type, sets, repetitions, hold, duration, rest, side, frequency.
// One component for the Edit exercise form, the template editor and the program sheet (amendment 67), so the chips and
// wording never drift apart. It holds no state of its own: the parent owns the DoseValue.
import { useEffect, useId, useState } from 'react';
import { filterChip, inputCls, segOption, segTrack } from '@/components/ui';
import type { ExerciseSide, SessionsPerDay } from '@/domain/hep';
import {
  DOSE_CHIPS,
  DOSE_KIND_LABELS,
  DOSE_LIMITS,
  SIDE_LABELS,
  applyProgressLabel,
  progressLabels,
  withKind,
  type DoseValue,
} from '@/domain/hepDose';
import type { DoseType } from '@/domain/hep';

interface ChipRowProps {
  label: string;
  unit?: string;
  chips: readonly number[];
  value: number | null;
  limits: readonly [number, number];
  onChange: (n: number) => void;
}

/** A row of quick chips plus "Other" for any whole number inside the limits. */
function ChipRow({ label, unit, chips, value, limits, onChange }: ChipRowProps) {
  const id = useId();
  const [otherOpen, setOtherOpen] = useState(false);
  const isOther = value != null && !chips.includes(value);
  const showInput = otherOpen || isOther;
  const suffix = unit ? ` ${unit}` : '';
  return (
    <div role="group" aria-labelledby={id} className="space-y-1.5">
      <div id={id} className="text-label font-medium text-[var(--muted)]">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((n) => (
          <button key={n} type="button" aria-pressed={value === n && !showInput} className={filterChip(value === n && !showInput)}
            onClick={() => { setOtherOpen(false); onChange(n); }}>
            {n}{suffix}
          </button>
        ))}
        <button type="button" aria-pressed={showInput} className={filterChip(showInput)} onClick={() => setOtherOpen(true)}>Other</button>
        {showInput && (
          <OtherNumber label={`${label}, other`} value={value} limits={limits} onChange={onChange} />
        )}
      </div>
    </div>
  );
}

/** A number box that lets the person clear it and type a new number; it commits only whole numbers inside the limits. */
function OtherNumber({ label, value, limits, onChange }: { label: string; value: number | null; limits: readonly [number, number]; onChange: (n: number) => void }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => { setText((t) => (t !== '' && Number(t) === value ? t : value == null ? '' : String(value))); }, [value]);
  return (
    <input
      type="number" inputMode="numeric" min={limits[0]} max={limits[1]} aria-label={label} className={`${inputCls} !w-20`} value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Math.trunc(Number(e.target.value));
        if (e.target.value === '' || !Number.isFinite(n)) return;
        const clamped = Math.min(limits[1], Math.max(limits[0], n));
        if (clamped !== n) setText(String(clamped));
        onChange(clamped);
      }}
      onBlur={() => setText(value == null ? '' : String(value))}
    />
  );
}

export interface ExerciseDoseEditorProps {
  value: DoseValue;
  onChange: (v: DoseValue) => void;
  /** Shown as "Same as the program (N)" under Frequency. Absent in the Library (no program yet). */
  programSessionsPerDay?: SessionsPerDay;
  /** Show the Progress chips (+1 set, +2 reps ...): only on a program that is already running. */
  showProgress?: boolean;
  /** Show the "Optional" switch (templates and programs; not the Library). */
  showOptional?: boolean;
}

export function ExerciseDoseEditor({ value, onChange, programSessionsPerDay, showProgress = false, showOptional = false }: ExerciseDoseEditorProps) {
  const kindId = useId();
  const set = (patch: Partial<DoseValue>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div id={kindId} className="text-label font-medium text-[var(--muted)]">Dosage type</div>
        <div role="group" aria-labelledby={kindId} className={segTrack}>
          {(['reps', 'hold', 'timed'] as DoseType[]).map((k) => (
            <button key={k} type="button" aria-pressed={value.kind === k} className={segOption(value.kind === k)} onClick={() => onChange(withKind(value, k))}>
              {DOSE_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      <ChipRow label="Sets" chips={DOSE_CHIPS.sets} value={value.sets} limits={DOSE_LIMITS.sets} onChange={(n) => set({ sets: n })} />
      {value.kind !== 'timed' && (
        <ChipRow label="Repetitions" chips={DOSE_CHIPS.reps} value={value.reps} limits={DOSE_LIMITS.reps} onChange={(n) => set({ reps: n })} />
      )}
      {value.kind === 'hold' && (
        <ChipRow label="Hold" unit="s" chips={DOSE_CHIPS.hold} value={value.holdSeconds} limits={DOSE_LIMITS.hold} onChange={(n) => set({ holdSeconds: n })} />
      )}
      {value.kind === 'timed' && (
        <ChipRow label="Duration" unit="s" chips={DOSE_CHIPS.time} value={value.durationSeconds} limits={DOSE_LIMITS.time} onChange={(n) => set({ durationSeconds: n })} />
      )}
      <ChipRow label="Rest between sets" unit="s" chips={DOSE_CHIPS.rest} value={value.restSeconds} limits={DOSE_LIMITS.rest} onChange={(n) => set({ restSeconds: n })} />

      <label className="block">
        <span className="mb-1 block text-label font-medium text-[var(--muted)]">Side</span>
        <select className={inputCls} value={value.side} onChange={(e) => set({ side: e.target.value as ExerciseSide })}>
          {(Object.keys(SIDE_LABELS) as ExerciseSide[]).map((s) => <option key={s} value={s}>{SIDE_LABELS[s]}</option>)}
        </select>
      </label>

      <Frequency value={value.sessionsPerDay} programSessionsPerDay={programSessionsPerDay} onChange={(n) => set({ sessionsPerDay: n })} />

      {showOptional && value.optional !== undefined && (
        <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
          <input type="checkbox" className="h-4 w-4" checked={value.optional} onChange={(e) => set({ optional: e.target.checked })} />
          Optional <span className="text-hint text-[var(--muted)]">(the patient may skip it; it does not count against them)</span>
        </label>
      )}

      {showProgress && (
        <div className="space-y-1.5">
          <div className="text-label font-medium text-[var(--muted)]">Progress</div>
          <div className="flex flex-wrap gap-1.5">
            {progressLabels(value.kind).map((l) => (
              <button key={l} type="button" className={filterChip(false)} onClick={() => onChange(applyProgressLabel(value, l))}>{l}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Frequency({ value, programSessionsPerDay, onChange }: { value: SessionsPerDay | null; programSessionsPerDay?: SessionsPerDay; onChange: (n: SessionsPerDay | null) => void }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-1.5">
      <div id={id} className="text-label font-medium text-[var(--muted)]">Frequency</div>
      <div className="flex flex-wrap gap-1.5">
        {programSessionsPerDay != null && (
          <button type="button" aria-pressed={value == null} className={filterChip(value == null)} onClick={() => onChange(null)}>
            Same as the program ({programSessionsPerDay})
          </button>
        )}
        {([1, 2, 3] as SessionsPerDay[]).map((n) => (
          <button key={n} type="button" aria-pressed={value === n} className={filterChip(value === n)} onClick={() => onChange(n)}>{n}× daily</button>
        ))}
      </div>
    </div>
  );
}
