// Pick exercises for a template or a program: the Library's grid with ticks, plus a Templates tab and (when the patient
// is known) their earlier programs. What is chosen sits in a side panel on wide screens and a bottom strip on phones
// (one element, laid out by CSS). Exercises already in the program are faded with "In program" and cannot be chosen;
// "Add all" skips them. Everything is handed back as program items, already placed in the requested block.
import { useEffect, useMemo, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { Button } from '@/components/Button';
import { LoadingRows, SheetDialog, btnPrimary, btnSecondary } from '@/components/ui';
import type { Exercise, ExerciseTemplate } from '@/domain/hep';
import { hepService, type HepItemInput, type ProgramBundle } from '@/services/hepService';
import { ExerciseForm } from './ExerciseForm';
import { LibraryBrowser } from './LibraryBrowser';
import { exerciseToItem, intoBlock, itemsMinutes, programItemToInput, templateItemToInput, type ItemBlock } from './hepItems';
import { PackList, type Pack } from './PickerPacks';
import { StarterSetSheet } from './StarterSetSheet';
import { useExerciseUseCounts, useExercises, useOnline, useUsedThisWeek } from './useHepData';

export type PickerTab = 'exercises' | 'templates' | 'earlier';
export interface AddMeta { templateId?: string; suggestedTitle?: string }

export interface ExercisePickerProps {
  open: boolean;
  onClose: () => void;
  /** The chosen exercises as program items, already placed in `target`. `meta` comes with a template or an earlier program. */
  onAdd: (items: HepItemInput[], meta?: AddMeta) => void;
  /** Exercises already on the list (by source exercise id): shown, but cannot be chosen again. */
  disabledIds?: ReadonlySet<string>;
  patientId?: string;
  patientName?: string;
  /** The block being filled: the warm-up or cool-down; omitted = the main exercises. */
  target?: ItemBlock;
  initialTab?: PickerTab;
}

type TemplateRow = ExerciseTemplate & { usedCount: number };
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ExercisePicker({ open, onClose, onAdd, disabledIds, patientId, patientName, target, initialTab }: ExercisePickerProps) {
  const clinic = useClinic();
  const exercises = useExercises(clinic.id);
  const usedIds = useUsedThisWeek();
  const useCounts = useExerciseUseCounts();
  const online = useOnline();
  const [ticked, setTicked] = useState<string[]>([]);
  const [newName, setNewName] = useState<string | null>(null);
  const [tab, setTab] = useState<PickerTab>(initialTab ?? 'exercises');
  const [starterOpen, setStarterOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [earlier, setEarlier] = useState<ProgramBundle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const withPatient = !!patientId && !!patientName;
  useEffect(() => { if (open) { setTicked([]); setNewName(null); setTab(initialTab ?? 'exercises'); } }, [open, initialTab]);
  useEffect(() => {
    if (!open || !online) return;
    let live = true;
    Promise.resolve().then(() => hepService.listTemplates(clinic.id)).then((t) => { if (live) setTemplates(t); }).catch((e) => { if (live) setLoadError(e instanceof Error ? e.message : 'Could not load the templates.'); });
    if (patientId) Promise.resolve().then(() => hepService.listPatientPrograms(patientId, '2000-01-01')).then((p) => { if (live) setEarlier(p); }).catch(() => { if (live) setEarlier([]); });
    return () => { live = false; };
  }, [open, online, clinic.id, patientId]);

  const block = target ?? 'main';
  const byId = new Map((exercises ?? []).map((e) => [e.id, e]));
  const chosen = ticked.map((id) => byId.get(id)).filter((e): e is Exercise => !!e);
  const chosenItems = useMemo(() => chosen.map(exerciseToItem), [chosen]);
  const toggle = (ex: Exercise) => setTicked((cur) => (cur.includes(ex.id) ? cur.filter((x) => x !== ex.id) : [...cur, ex.id]));
  const finish = (items: HepItemInput[], meta?: AddMeta) => { onAdd(intoBlock(items, block), meta); onClose(); };
  const free = (i: { sourceExerciseId?: string | null }) => !(i.sourceExerciseId && disabledIds?.has(i.sourceExerciseId));

  const templatePacks: Pack[] = (templates ?? []).map((t) => ({
    id: t.id, title: t.title,
    meta: `${plural(t.items.length, 'exercise', 'exercises')} · used ${t.usedCount}×`,
    exercises: t.items, addable: t.items.filter(free).length,
  }));
  const earlierPacks: Pack[] = (earlier ?? []).map(({ program: p }) => {
    const live = p.items.filter((i) => i.removedOn == null);
    return { id: p.id, title: p.title, meta: `${plural(live.length, 'exercise', 'exercises')} · from ${p.startDate}`, exercises: live, addable: live.filter(free).length };
  });
  const addTemplate = (pack: Pack) => {
    const t = templates?.find((x) => x.id === pack.id);
    if (t) finish(t.items.filter(free).map(templateItemToInput), { templateId: t.id, suggestedTitle: t.title });
  };
  const addEarlier = (pack: Pack) => {
    const p = earlier?.find((x) => x.program.id === pack.id)?.program;
    if (p) finish(p.items.filter((i) => i.removedOn == null).filter(free).map((i) => ({ ...programItemToInput(i), id: undefined })), { suggestedTitle: p.title });
  };

  const minutes = chosen.length > 0 ? itemsMinutes(chosenItems) : 0;
  const title = target === 'warm_up' ? 'Add to the warm-up' : target === 'cool_down' ? 'Add to the cool-down' : 'Add exercises';
  const tabs: Array<[PickerTab, string]> = [['exercises', 'Exercises'], ['templates', 'Templates'], ...(withPatient ? [['earlier', `${firstName(patientName)}’s earlier programs`] as [PickerTab, string]] : [])];

  const empty = (
    <div className="space-y-3 rounded-2xl border border-dashed border-[var(--border)] p-6 text-center">
      <p className="font-display text-base font-semibold text-[var(--ink)]">Your Library is empty</p>
      <p className="mx-auto max-w-md text-sm text-[var(--muted)]">Start from the starter library, or create the exercises you prescribe most.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" className={btnPrimary} onClick={() => setStarterOpen(true)}>Add the starter library</Button>
        <Button type="button" className={btnSecondary} disabled={!online} onClick={() => setNewName('')}>Or create your own exercise</Button>
      </div>
    </div>
  );

  const basket = (
    <aside aria-label="Chosen exercises" className="sticky bottom-0 z-[1] -mx-1 border-t border-[var(--border)] bg-[var(--surface)] p-2 desktop:static desktop:top-0 desktop:mx-0 desktop:self-start desktop:rounded-xl desktop:border desktop:p-3">
      <div className="flex items-center gap-2 desktop:flex-col desktop:items-stretch desktop:gap-2">
        <div className="text-sm font-semibold text-[var(--ink)]">{chosen.length === 0 ? 'Nothing chosen yet' : `Adding · ${chosen.length}`}</div>
        <ul className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto desktop:flex-col desktop:gap-1 desktop:overflow-visible">
          {chosen.map((e) => (
            <li key={e.id} className="flex shrink-0 items-center justify-between gap-2 rounded-full bg-[var(--paper)] px-2.5 py-0.5 text-sm text-[var(--ink)] desktop:rounded-none desktop:bg-transparent desktop:px-0">
              <span className="max-w-40 truncate desktop:max-w-none">{e.title}</span>
              <button type="button" aria-label={`Remove ${e.title}`} className="text-[var(--muted)] hover:text-[var(--rust)]" onClick={() => toggle(e)}>✕</button>
            </li>
          ))}
        </ul>
        {chosen.length > 0 && <p className="hidden text-xs text-[var(--muted)] desktop:block">About {minutes} more {minutes === 1 ? 'minute' : 'minutes'} per session</p>}
        <Button type="button" className={btnPrimary} disabled={chosen.length === 0} onClick={() => finish(chosenItems)}>{chosen.length === 0 ? 'Add' : `Add ${chosen.length}`}</Button>
      </div>
    </aside>
  );

  return (
    <>
      <SheetDialog open={open && newName === null} wide="xl" title={title} onClose={onClose} footer={<Button type="button" className={btnSecondary} onClick={onClose}>Cancel</Button>}>
        {!exercises ? <LoadingRows rows={4} label="Loading the Library" /> : (
          <div className="space-y-3">
            <div role="tablist" aria-label="Where to pick from" className="flex gap-1 border-b border-[var(--border)]">
              {tabs.map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                  className={`min-h-10 px-3 text-sm ${tab === key ? 'border-b-2 border-[var(--teal)] font-semibold text-[var(--teal-strong)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}>{label}</button>
              ))}
            </div>
            {tab === 'exercises' && (
              <div className="grid gap-3 desktop:grid-cols-[1fr_15rem]">
                <LibraryBrowser
                  clinicId={clinic.id}
                  exercises={exercises}
                  usedIds={usedIds}
                  useCounts={useCounts}
                  selected={new Set(ticked)}
                  disabledIds={disabledIds}
                  fixedView="grid"
                  onActivate={toggle}
                  emptyState={empty}
                  renderNoMatches={(q) => (
                    <Button type="button" className={`${btnSecondary} mt-3`} disabled={!online} onClick={() => setNewName(q)}>
                      {online ? `+ New exercise “${q}”` : 'New exercises need a connection'}
                    </Button>
                  )}
                />
                {basket}
              </div>
            )}
            {tab === 'templates' && (!online ? <p className="py-6 text-center text-sm text-[var(--muted)]">Templates need a connection.</p>
              : loadError ? <p className="py-6 text-center text-sm text-[var(--rust)]">{loadError}</p>
              : !templates ? <LoadingRows rows={3} label="Loading templates" />
              : <div className="@container"><PackList clinicId={clinic.id} packs={templatePacks} library={exercises} regionChips empty="No templates yet." onAddAll={addTemplate} /></div>)}
            {tab === 'earlier' && (!online ? <p className="py-6 text-center text-sm text-[var(--muted)]">Earlier programs need a connection.</p>
              : !earlier ? <LoadingRows rows={3} label="Loading earlier programs" />
              : <div className="@container"><PackList clinicId={clinic.id} packs={earlierPacks} library={exercises} empty="No earlier programs for this patient." onAddAll={addEarlier} /></div>)}
          </div>
        )}
      </SheetDialog>
      <StarterSetSheet open={open && starterOpen} onClose={() => setStarterOpen(false)} />
      <ExerciseForm
        open={open && newName !== null}
        clinicId={clinic.id}
        allExercises={exercises ?? []}
        initialTitle={newName ?? ''}
        saveLabel="Save and add"
        onClose={() => setNewName(null)}
        onSaved={(_id, saved) => finish([...chosen, saved].map(exerciseToItem))}
      />
    </>
  );
}
