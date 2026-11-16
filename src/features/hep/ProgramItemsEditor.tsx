// The exercise list of a program or a template, in three blocks: an optional Warm-up, the Main exercises grouped by type
// (session order), and an optional Cool-down. Rows open to their dosage; the ⋯ menu moves a row between blocks or up
// and down inside its section (no drag: that would need a new dependency). Shared by the program sheet and the
// template editor. It holds no list of its own: the parent owns `items`.
import { useMemo, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { Button } from '@/components/Button';
import { Field, KebabMenu, btnPrimary, btnSecondary, inputCls, menuItem } from '@/components/ui';
import { EXERCISE_PHASE_LABELS, type Exercise, type ExercisePhase, type Program, type SessionsPerDay } from '@/domain/hep';
import { describeDose } from '@/domain/hepDose';
import type { HepItemInput, ProgramBundle } from '@/services/hepService';
import { ExerciseDoseEditor } from './ExerciseDoseEditor';
import { Thumb, TypeTag } from './LibraryParts';
import { blockOf, itemDose, mainPhaseFor, moveToBlock, moveWithinSection, programBlocks, withItemDose, type ItemBlock } from './hepItems';
import { itemProgress, itemProgressLine } from './itemProgress';
import type { PickerTab } from './ExercisePicker';
import { estimateLabel, isSectionOptional, setSectionOptional } from './programDraft';
import { useThumbUrls } from './useHepData';

export interface ProgramItemsEditorProps {
  items: HepItemInput[];
  setItems: (items: HepItemInput[]) => void;
  /** The program's frequency (a template passes its commonest one). */
  sessionsPerDay: SessionsPerDay;
  /** The clinic's exercises: thumbnails, and the type a row goes back to on "Move to main exercises". */
  library: Exercise[];
  /** Editing a running program: rows show "So far" and the Progress chips. */
  editingLive?: boolean;
  live?: Program;
  bundle?: ProgramBundle;
  today?: string;
  /** Opens the picker for a block. */
  onAdd: (target: ItemBlock) => void;
  /** Templates: no note to patient and no "Same as the program" frequency. */
  forTemplate?: boolean;
  /** The empty list's quick starts (picker tabs). Absent: one "Add exercises". */
  onQuickStart?: (tab: PickerTab) => void;
  /** Show "Repeat an earlier program" among the quick starts. */
  canRepeatEarlier?: boolean;
}

export const SESSION_LABEL = ['', 'once a day', 'twice a day', '3 times a day'];
type Row = { item: HepItemInput; index: number };

export function ProgramItemsEditor(props: ProgramItemsEditorProps) {
  const { items, setItems, sessionsPerDay, library, onAdd, onQuickStart, canRepeatEarlier } = props;
  const clinic = useClinic();
  const [openRow, setOpenRow] = useState<number | null>(null);
  const blocks = programBlocks(items);
  const mainCount = blocks.main.reduce((n, s) => n + s.rows.length, 0);
  const estimate = estimateLabel(items, sessionsPerDay);

  const byId = useMemo(() => new Map(library.map((e) => [e.id, e])), [library]);
  const pictured = useMemo(() => items.map((i) => (i.sourceExerciseId ? byId.get(i.sourceExerciseId) : undefined)).filter((e): e is Exercise => !!e), [items, byId]);
  const thumbs = useThumbUrls(clinic.id, pictured);

  const change = (next: HepItemInput[]) => { setItems(next); setOpenRow(null); };
  const rowProps = { ...props, thumbs, byId, openRow, setOpenRow, change };

  const quickStart = (tab: PickerTab) => (onQuickStart ? onQuickStart(tab) : onAdd('main'));
  const optionalBox = (phase: ExercisePhase, label: string) => (
    <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
      <input type="checkbox" aria-label={`Optional: make all of ${label} optional`} checked={isSectionOptional(items, phase)} onChange={(e) => setItems(setSectionOptional(items, phase, e.target.checked))} /> Optional
    </label>
  );

  const block = (phase: 'warm_up' | 'cool_down', rows: Row[], hint: string) => {
    const label = EXERCISE_PHASE_LABELS[phase];
    const lower = label.toLowerCase();
    return (
      <section aria-label={label} className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-sm font-semibold text-[var(--ink)]"><span>{label}</span> <span className="font-normal text-[var(--muted)]">· optional</span></h3>
          <div className="flex-1" />
          {rows.length > 0 && optionalBox(phase, label)}
        </div>
        {rows.length > 0 && <ul className="space-y-1.5">{rows.map((r, pos) => <ItemRow key={rowKey(r)} row={r} first={pos === 0} last={pos === rows.length - 1} {...rowProps} />)}</ul>}
        <button type="button" onClick={() => onAdd(phase)}
          className="flex w-full flex-wrap gap-x-2.5 gap-y-1 rounded-xl border-[1.5px] border-dashed border-[var(--border)] px-3 py-2.5 text-left text-sm font-medium text-[var(--teal)] hover:border-[var(--teal)] hover:bg-[var(--teal-light)]">
          {rows.length > 0 ? `+ Add to ${lower}` : `+ Add a ${lower}`} <span className="font-normal text-[var(--muted)]">{hint}</span>
        </button>
      </section>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-[var(--muted)]" aria-live="polite">{items.length} {items.length === 1 ? 'exercise' : 'exercises'}{estimate && <> · {estimate}</>}</p>
        <div className="flex-1" />
        <Button type="button" className={btnSecondary} onClick={() => onAdd('main')}>+ Add exercises</Button>
      </div>

      {items.length === 0 && (
        <div className="space-y-3 rounded-xl border border-dashed border-[var(--border)] p-5 text-center">
          <p className="text-sm text-[var(--muted)]">No exercises yet.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" className={btnPrimary} onClick={() => quickStart('exercises')}>Add exercises</Button>
            {onQuickStart && <Button type="button" className={btnSecondary} onClick={() => onQuickStart('templates')}>Start from a template</Button>}
            {onQuickStart && canRepeatEarlier && <Button type="button" className={btnSecondary} onClick={() => onQuickStart('earlier')}>Repeat an earlier program</Button>}
          </div>
        </div>
      )}

      {block('warm_up', blocks.warmUp, 'Done first, before the main exercises')}

      <section aria-label="Main exercises" className="space-y-3 border-y border-[var(--border)] py-3">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-sm font-semibold text-[var(--ink)]"><span>Main exercises</span> <span className="font-normal text-[var(--muted)]">· {mainCount}</span></h3>
          <div className="flex-1" />
          <span className="text-xs text-[var(--muted)]">Grouped by type</span>
        </div>
        {blocks.main.map((s) => (
          <section key={s.phase} aria-label={EXERCISE_PHASE_LABELS[s.phase]} className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
              <TypeTag phase={s.phase} /> <span className="font-normal text-[var(--muted)]">· {s.rows.length}</span>
              <div className="flex-1" />
              {optionalBox(s.phase, EXERCISE_PHASE_LABELS[s.phase])}
            </div>
            <ul className="space-y-1.5">{s.rows.map((r, pos) => <ItemRow key={rowKey(r)} row={r} first={pos === 0} last={pos === s.rows.length - 1} {...rowProps} />)}</ul>
          </section>
        ))}
      </section>

      {block('cool_down', blocks.coolDown, 'Done last, after the main exercises')}
    </div>
  );
}

const rowKey = ({ item, index }: Row) => `${item.id ?? item.sourceExerciseId ?? item.title}-${index}`;

function ItemRow({ row, first, last, items, sessionsPerDay, library, editingLive, live, bundle, today, forTemplate, thumbs, byId, openRow, setOpenRow, change, setItems }: ProgramItemsEditorProps & {
  row: Row; first: boolean; last: boolean;
  thumbs: Record<string, string>; byId: Map<string, Exercise>;
  openRow: number | null; setOpenRow: (i: number | null) => void; change: (next: HepItemInput[]) => void;
}) {
  const { item, index } = row;
  const open = openRow === index;
  const src = item.sourceExerciseId ? byId.get(item.sourceExerciseId) : undefined;
  // A row shows its source exercise's picture unless that exercise hides its pictures in lists (no source in the cache yet: no picture yet).
  const override = !forTemplate && item.sessionsPerDay !== sessionsPerDay;
  const liveItem = live?.items.find((i) => i.id === item.id);
  const block = blockOf(item.phase);
  const moves: Array<[ItemBlock, string]> = block === 'main' ? [['warm_up', 'Move to warm-up'], ['cool_down', 'Move to cool-down']] : [['main', 'Move to main exercises']];
  const update = (fn: (i: HepItemInput) => HepItemInput) => setItems(items.map((it, i) => (i === index ? fn(it) : it)));

  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex min-w-0 items-center gap-1 p-2 sm:gap-2">
        {src && !src.hidePicturesInLists && <Thumb ex={src} url={src.thumbKey ? thumbs[src.thumbKey] : undefined} size={40} />}
        <button type="button" aria-expanded={open} className="min-w-0 flex-1 overflow-hidden text-left" onClick={() => setOpenRow(open ? null : index)}>
          <span className="block truncate text-sm font-semibold text-[var(--ink)]">{item.title}{item.optional && <span className="ml-2 text-xs font-medium text-[var(--muted)]">Optional</span>}</span>
          <span className="block truncate text-xs text-[var(--muted)]">{describeDose(itemDose(item), forTemplate ? 1 : sessionsPerDay)}{override && ` · Only this one: ${SESSION_LABEL[item.sessionsPerDay]}`}</span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <Button
            type="button"
            aria-label={`Move ${item.title} up`}
            disabled={first}
            className="min-h-9 min-w-7 rounded-md text-sm text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)] disabled:opacity-30 sm:min-w-8"
            onClick={() => change(moveWithinSection(items, index, -1))}
          >
            ↑
          </Button>
          <Button
            type="button"
            aria-label={`Move ${item.title} down`}
            disabled={last}
            className="min-h-9 min-w-7 rounded-md text-sm text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)] disabled:opacity-30 sm:min-w-8"
            onClick={() => change(moveWithinSection(items, index, 1))}
          >
            ↓
          </Button>
          <KebabMenu ariaLabel={`More for ${item.title}`}>
            {(close) => (
              <div data-row-menu className="py-1">
                {moves.map(([to, label]) => (
                  <button key={to} type="button" className={menuItem} onClick={() => { close(); change(moveToBlock(items, index, to, mainPhaseFor(item, library))); }}>{label}</button>
                ))}
              </div>
            )}
          </KebabMenu>
          <Button type="button" aria-label={`Remove ${item.title}`} className="min-h-9 min-w-8 text-[var(--rust)] sm:min-w-9" onClick={() => change(items.filter((_, i) => i !== index))}>✕</Button>
        </div>
      </div>
      {open && (
        <div className="space-y-3 border-t border-[var(--border)] p-3">
          {editingLive && live && bundle && liveItem && today && <p className="text-xs text-[var(--muted)]">So far: {itemProgressLine(itemProgress(liveItem, live, bundle.logs, bundle.sessionFeedback, today))}</p>}
          {forTemplate ? (
            <ExerciseDoseEditor value={itemDose(item)} showOptional onChange={(d) => update((it) => withItemDose(it, d))} />
          ) : (
            <ExerciseDoseEditor
              value={{ ...itemDose(item), sessionsPerDay: override ? item.sessionsPerDay : null }}
              programSessionsPerDay={sessionsPerDay}
              showOptional
              showProgress={!!editingLive && !!item.id}
              onChange={(d) => update((it) => withItemDose(it, { ...d, sessionsPerDay: d.sessionsPerDay ?? sessionsPerDay }))}
            />
          )}
          {!forTemplate && (
            <Field label="Note to patient (optional, any language)">
              <textarea className={inputCls} rows={2} maxLength={300} value={item.specialInstructions ?? ''} onChange={(e) => update((it) => ({ ...it, specialInstructions: e.target.value }))} />
            </Field>
          )}
        </div>
      )}
    </li>
  );
}
