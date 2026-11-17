// The exercise form's folding sections (Exercise details, Media and instructions, Default dosage, Classification) and the
// pure summary lines each shows when folded. The form (ExerciseForm.tsx) owns every value; these only draw and report.
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Field, btnPrimary, btnSecondary, filterChip, inputCls } from '@/components/ui';
import { SwitchRow } from '@/features/settings/settingsShared';
import {
  EXERCISE_PHASE_LABELS,
  EXERCISE_TYPES,
  EXERCISE_TYPE_DEFINITIONS,
  EXERCISE_TYPE_TONE,
  HEP_EQUIPMENT,
  HEP_POSITIONS,
  canonicalEquipment,
  isMainType,
  type ExercisePhase,
} from '@/domain/hep';
import { PictureField, type Picture } from './PictureField';

export type SectionKey = 'details' | 'media' | 'dose' | 'class';
export const SECTION_TITLES: Record<SectionKey, string> = {
  details: 'Exercise details',
  media: 'Media and instructions',
  dose: 'Default dosage',
  class: 'Classification',
};
export const SECTION_ORDER: readonly SectionKey[] = ['details', 'media', 'dose', 'class'];

/** The region pill that reveals the free-text region box. */
export const OTHER_REGION = '__other';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const stepLines = (steps: string) => steps.split('\n').map((s) => s.trim()).filter(Boolean);

/** "Name · Region · Type" (plus any additional types). The type is left out until one has been chosen. */
export function detailsSummary(
  title: string,
  region: string,
  phase: ExercisePhase,
  typeChosen: boolean,
  alsoPhases: ExercisePhase[] = [],
): string {
  const extra = alsoPhases.filter((p) => p !== phase);
  const typeLabel = typeChosen ? [phase, ...extra].map((p) => EXERCISE_PHASE_LABELS[p]).join(', ') : '';
  return [title.trim(), region, typeLabel].filter(Boolean).join(' · ');
}

/** "2 photos · 3 steps · precautions set". */
export function mediaSummary(pictures: Pick<Picture, 'isGif'>[], steps: string, stopIf: string): string {
  const media = pictures.length === 0 ? 'No media' : pictures.some((p) => p.isGif) ? '1 GIF' : plural(pictures.length, 'photo', 'photos');
  return [media, plural(stepLines(steps).length, 'step', 'steps'), stopIf.trim() ? 'precautions set' : ''].filter(Boolean).join(' · ');
}

/** Positions, equipment, "+ Region", and quoted alternative names. Empty when nothing is set. */
export function classificationSummary(positions: string[], equipment: string[], also: string[], otherNames: string[]): string {
  return [...positions, ...equipment, ...also.map((a) => `+ ${a}`), ...otherNames.map((n) => `“${n}”`)].join(' · ');
}

export interface FormSectionProps {
  index: number;
  title: string;
  open: boolean;
  done: boolean;
  summary: string;
  onToggle: () => void;
  /** The title of the next section still to do; absent on the last one (it ends with Done). */
  nextTitle: string | null;
  onNext: () => void;
  children: ReactNode;
}

/** A card that folds into a one-line summary. The status dot shows the section's number, or ✓ once it is done. */
export function FormSection({ index, title, open, done, summary, onToggle, nextTitle, onNext, children }: FormSectionProps) {
  const bodyId = useId();
  return (
    <section className={`rounded-xl border bg-[var(--surface)] ${open ? 'border-[var(--teal)] ring-1 ring-[var(--teal-light)]' : 'border-[var(--border)]'}`}>
      <h3 className="m-0">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}
          className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 px-3.5 py-3 text-left">
          <span aria-hidden="true" className={`grid h-[22px] w-[22px] place-items-center rounded-full border-[1.5px] text-xs font-bold ${done ? 'border-[var(--moss)] bg-[var(--moss)] text-white' : 'border-[var(--border)] text-[var(--muted)]'}`}>
            {done ? '✓' : index + 1}
          </span>
          <span className="min-w-0">
            <span className="block font-display text-sm font-semibold text-[var(--ink)]">{title}</span>
            {!open && <span className="block truncate text-xs text-[var(--muted)]">{summary || 'Not set'}</span>}
          </span>
          {!open && <span className="text-xs font-medium text-[var(--teal)]">{done ? 'Edit' : 'Open'}</span>}
        </button>
      </h3>
      {/* Folded bodies stay mounted (only hidden): PictureField revokes its new photos' object URLs when it unmounts, and
          the form and the preview phone still show those photos. They are let go when the sheet itself closes. */}
      <div id={bodyId} hidden={!open} className="min-w-0 space-y-4 px-3.5 pb-3.5 pt-0.5 sm:pl-[2.875rem]">
        {children}
        <div className="flex justify-end">
          {nextTitle
            ? <Button type="button" className={btnPrimary} onClick={onNext}>Next: {nextTitle} ›</Button>
            : <Button type="button" className={btnSecondary} onClick={onNext}>Done</Button>}
        </div>
      </div>
    </section>
  );
}

function PillGroup({ label, optional = false, children }: { label: string; optional?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="text-label font-medium text-[var(--muted)]">
        <span id={id}>{label}</span>{optional && <span className="ml-1.5 text-hint font-normal">optional</span>}
      </div>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export interface DetailsFieldsProps {
  title: string;
  setTitle: (v: string) => void;
  similarNote: ReactNode;
  regionOptions: string[];
  region: string;
  setRegion: (v: string) => void;
  customRegion: string;
  setCustomRegion: (v: string) => void;
  phase: ExercisePhase;
  /** False on a new exercise until a Type pill is tapped (the phase starts at 'other', so it can't tell on its own). */
  typeChosen: boolean;
  onType: (p: ExercisePhase) => void;
  alsoPhases: ExercisePhase[];
  setAlsoPhases: (v: ExercisePhase[]) => void;
}

export function DetailsFields(p: DetailsFieldsProps) {
  const typePills: ExercisePhase[] = [...EXERCISE_TYPES, 'other'];
  // A legacy Warm-up or Cool-down exercise keeps its value (as a pressed pill) until the therapist picks another type.
  if (p.phase === 'warm_up' || p.phase === 'cool_down') typePills.push(p.phase);
  const alsoTypePills: ExercisePhase[] = ([...EXERCISE_TYPES, 'other'] as ExercisePhase[]).filter(
    (t) => !(p.typeChosen && t === p.phase),
  );
  const toggleAlsoPhase = (t: ExercisePhase) =>
    p.setAlsoPhases(p.alsoPhases.includes(t) ? p.alsoPhases.filter((x) => x !== t) : [...p.alsoPhases, t]);
  const definition = p.typeChosen && isMainType(p.phase) ? EXERCISE_TYPE_DEFINITIONS[p.phase] : 'Sets the default dosage and the section the patient sees it under.';
  return (
    <>
      <Field label="Exercise name">
        <input className={inputCls} value={p.title} maxLength={80} onChange={(e) => p.setTitle(e.target.value)} placeholder="For example Straight leg raise" />
      </Field>
      {p.similarNote}
      <PillGroup label="Body region">
        {p.regionOptions.map((r) => (
          <button key={r} type="button" aria-pressed={p.region === r} className={filterChip(p.region === r)} onClick={() => p.setRegion(r)}>{r}</button>
        ))}
        <button type="button" aria-pressed={p.region === OTHER_REGION} className={filterChip(p.region === OTHER_REGION)} onClick={() => p.setRegion(OTHER_REGION)}>Other region…</button>
      </PillGroup>
      {p.region === OTHER_REGION && (
        <input className={inputCls} aria-label="New region name" placeholder="Region name" value={p.customRegion} maxLength={40} onChange={(e) => p.setCustomRegion(e.target.value)} />
      )}
      <div className="space-y-2.5">
        <div className="space-y-1.5">
          <PillGroup label="Type">
            {typePills.map((t) => {
              const on = p.typeChosen && p.phase === t;
              return (
                <button key={t} type="button" aria-pressed={on} className={filterChip(on)} onClick={() => p.onType(t)}>
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--${EXERCISE_TYPE_TONE[t]})` }} />
                  {EXERCISE_PHASE_LABELS[t]}
                </button>
              );
            })}
          </PillGroup>
          <p className="rounded-lg bg-[var(--paper)] px-2.5 py-1.5 text-xs text-[var(--muted)]">{definition}</p>
        </div>
        <div className="space-y-1">
          <PillGroup label="Additional types" optional>
            {alsoTypePills.map((t) => {
              const on = p.alsoPhases.includes(t);
              return (
                <button key={t} type="button" aria-pressed={on} className={filterChip(on)} onClick={() => toggleAlsoPhase(t)}>
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--${EXERCISE_TYPE_TONE[t]})` }} />
                  {EXERCISE_PHASE_LABELS[t]}
                </button>
              );
            })}
          </PillGroup>
          <p className="text-hint text-[var(--muted)]">Also appears under these types when filtering the library.</p>
        </div>
      </div>
    </>
  );
}

const STOP_IF_SUGGESTIONS = ['Sharp pain', 'Pain that gets worse', 'Dizziness', 'Numbness or tingling', 'Chest pain or breathlessness'];

export interface MediaFieldsProps {
  pictures: Picture[];
  setPictures: (next: Picture[]) => void;
  onProblem: (m: string | null) => void;
  busy: boolean;
  steps: string;
  setSteps: (v: string) => void;
  stopIf: string;
  setStopIf: (fn: (cur: string) => string) => void;
  /** The consent line's state; the box is only drawn when there are pictures. */
  consent: ConsentState;
  hidePictures: boolean;
  setHidePictures: (v: boolean) => void;
}

export interface ConsentState {
  /** "10/11": consent already on record for exactly these pictures, shown instead of a box. */
  recordedOn: string | null;
  ticked: boolean;
  onTick: (v: boolean) => void;
  /** The save was refused for want of the tick: the box turns amber with the reason. */
  blocked: boolean;
  /** Pictures that were saved before consent existed: a gentle prompt, never a block. */
  legacy: boolean;
}

function ConsentBox({ c }: { c: ConsentState }) {
  const id = useId();
  if (c.recordedOn) {
    return <p className="rounded-xl bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)]" role="status">Consent recorded {c.recordedOn}</p>;
  }
  return (
    <div className={`rounded-xl border px-3 py-2 ${c.blocked ? 'border-[var(--amber-strong)] bg-[var(--amber-light)]' : 'border-[var(--border)] bg-[var(--paper)]'}`}>
      <label className="flex min-h-11 cursor-pointer items-start gap-2.5 py-1.5">
        <input type="checkbox" aria-label="I have consent from the person shown to use these pictures with patients." aria-describedby={`${id}-hint`} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--teal)]" checked={c.ticked} onChange={(e) => c.onTick(e.target.checked)} />
        <span>
          <span className="block text-sm font-medium text-[var(--ink)]">I have consent from the person shown to use these pictures with patients.</span>
          <span id={`${id}-hint`} className="block text-xs text-[var(--muted)]">Recorded with your name and the date.</span>
        </span>
      </label>
      {c.legacy && !c.blocked && <p className="text-xs text-[var(--muted)]">No consent is recorded for these pictures yet. Tick the box when you have it.</p>}
      {c.blocked && <p className="text-xs font-semibold text-[var(--amber-strong)]" role="alert">Tick consent to save these pictures, or remove them.</p>}
    </div>
  );
}

export function MediaFields(p: MediaFieldsProps) {
  const lines = stepLines(p.steps);
  return (
    <>
      <div className="space-y-1.5">
        <div className="text-label font-medium text-[var(--muted)]">Photos or GIF</div>
        <PictureField pictures={p.pictures} setPictures={p.setPictures} onProblem={p.onProblem} disabled={p.busy} />
      </div>
      {p.pictures.length > 0 && (
        <>
          <ConsentBox c={p.consent} />
          <SwitchRow
            label="Hide pictures in lists"
            hint="Library, picker and the patient's checklist show the name only. The pictures still show on the exercise page itself."
            checked={p.hidePictures}
            onChange={p.setHidePictures}
            disabled={p.busy}
          />
        </>
      )}
      <Field label="Instructions" hint="One step per line. Shown to the patient as numbered steps.">
        <textarea className={inputCls} rows={5} value={p.steps} onChange={(e) => p.setSteps(e.target.value)} placeholder={'Stand with your back to the wall\nSlide your arms up slowly'} />
      </Field>
      {lines.length > 0 && (
        <div className="rounded-xl bg-[var(--paper)] p-3">
          <div className="mb-1 text-xs font-semibold text-[var(--muted)]">Patient sees</div>
          <ol className="list-decimal space-y-0.5 pl-5 text-sm text-[var(--ink)]">{lines.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
      )}
      <Field label="Precautions" hint="Shown to the patient as “Stop if: …”.">
        <input className={inputCls} value={p.stopIf} maxLength={140} onChange={(e) => p.setStopIf(() => e.target.value)} placeholder="For example sharp or increasing pain" />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {STOP_IF_SUGGESTIONS.map((s) => (
          <button key={s} type="button" className={filterChip(false)}
            onClick={() => p.setStopIf((cur) => (cur.toLowerCase().includes(s.toLowerCase()) ? cur : cur.trim() ? `${cur.trim()}, ${s.toLowerCase()}` : s))}>{s}</button>
        ))}
      </div>
    </>
  );
}

export interface ClassificationFieldsProps {
  positions: string[];
  setPositions: (v: string[]) => void;
  equipment: string[];
  setEquipment: (v: string[]) => void;
  customEquipment: string;
  setCustomEquipment: (v: string) => void;
  /** Regions to offer under Additional body regions (the main region already left out). */
  alsoOptions: string[];
  also: string[];
  setAlso: (v: string[]) => void;
  otherNames: string[];
  setOtherNames: (v: string[]) => void;
  otherNameDraft: string;
  setOtherNameDraft: (v: string) => void;
  onAddOtherName: () => void;
}

export function ClassificationFields(p: ClassificationFieldsProps) {
  const equipmentPills = [...HEP_EQUIPMENT.filter((e) => e !== 'None'), ...p.equipment.filter((e) => !(HEP_EQUIPMENT as readonly string[]).includes(e))];
  // Positions saved before the fixed list (or typed elsewhere) stay visible so they can be removed.
  const positionPills = [...HEP_POSITIONS, ...p.positions.filter((x) => !(HEP_POSITIONS as readonly string[]).includes(x))];
  return (
    <>
      <PillGroup label="Position">
        {positionPills.map((x) => (
          <button key={x} type="button" aria-pressed={p.positions.includes(x)} className={filterChip(p.positions.includes(x))} onClick={() => p.setPositions(toggle(p.positions, x))}>{x}</button>
        ))}
      </PillGroup>
      <div className="space-y-1.5">
        <PillGroup label="Equipment" optional>
          {equipmentPills.map((e) => (
            <button key={e} type="button" aria-pressed={p.equipment.includes(e)} className={filterChip(p.equipment.includes(e))} onClick={() => p.setEquipment(toggle(p.equipment, e))}>{e}</button>
          ))}
        </PillGroup>
        <div className="flex gap-2">
          <input className={inputCls} aria-label="Other equipment" placeholder="Other equipment" value={p.customEquipment} maxLength={40} onChange={(e) => p.setCustomEquipment(e.target.value)} />
          <Button type="button" className={btnSecondary} disabled={!p.customEquipment.trim()}
            onClick={() => { const c = canonicalEquipment(p.customEquipment); if (c && !p.equipment.includes(c)) p.setEquipment([...p.equipment, c]); p.setCustomEquipment(''); }}>Add</Button>
        </div>
      </div>
      <PillGroup label="Additional body regions" optional>
        {p.alsoOptions.map((r) => (
          <button key={r} type="button" aria-pressed={p.also.includes(r)} className={filterChip(p.also.includes(r))} onClick={() => p.setAlso(toggle(p.also, r))}>{r}</button>
        ))}
      </PillGroup>
      <div className="space-y-1.5">
        <div className="text-label font-medium text-[var(--muted)]">Alternative names<span className="ml-1.5 text-hint font-normal">optional</span></div>
        {p.otherNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {p.otherNames.map((n) => <button key={n} type="button" className={filterChip(true)} aria-label={`Remove ${n}`} onClick={() => p.setOtherNames(p.otherNames.filter((x) => x !== n))}>{n} ✕</button>)}
          </div>
        )}
        <div className="flex gap-2">
          <input className={inputCls} aria-label="Add an alternative name" placeholder="Type a name, then Enter" value={p.otherNameDraft} maxLength={40} disabled={p.otherNames.length >= 6}
            onChange={(e) => p.setOtherNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); p.onAddOtherName(); } }} />
          <Button type="button" className={btnSecondary} onClick={p.onAddOtherName} disabled={!p.otherNameDraft.trim() || p.otherNames.length >= 6}>Add</Button>
        </div>
        <p className="text-hint text-[var(--muted)]">Used for search only, for example SLR. Not shown to patients.</p>
      </div>
    </>
  );
}
