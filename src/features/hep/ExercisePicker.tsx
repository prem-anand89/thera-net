// Pick exercises from the Library for a template or a program: the Library's own layout with ticks, a basket at the
// side on wide screens, "Used this week" first, and "+ New exercise" when a search finds nothing.
import { useEffect, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { Button } from '@/components/Button';
import { LoadingRows, SheetDialog, btnPrimary, btnSecondary } from '@/components/ui';
import type { Exercise } from '@/domain/hep';
import { ExerciseForm } from './ExerciseForm';
import { LibraryBrowser } from './LibraryBrowser';
import { useExercises, useOnline, useUsedThisWeek } from './useHepData';

export interface ExercisePickerProps {
  open: boolean;
  onClose: () => void;
  /** The ticked exercises (or the one just created), when the person adds them. */
  onAdd: (exercises: Exercise[]) => void;
  /** Exercises already on the list: shown, but cannot be ticked again. */
  disabledIds?: ReadonlySet<string>;
}

export function ExercisePicker({ open, onClose, onAdd, disabledIds }: ExercisePickerProps) {
  const clinic = useClinic();
  const exercises = useExercises(clinic.id);
  const usedIds = useUsedThisWeek();
  const online = useOnline();
  const [ticked, setTicked] = useState<string[]>([]);
  const [newName, setNewName] = useState<string | null>(null);

  useEffect(() => { if (open) { setTicked([]); setNewName(null); } }, [open]);

  const byId = new Map((exercises ?? []).map((e) => [e.id, e]));
  const chosen = ticked.map((id) => byId.get(id)).filter((e): e is Exercise => !!e);
  const toggle = (ex: Exercise) => setTicked((cur) => (cur.includes(ex.id) ? cur.filter((x) => x !== ex.id) : [...cur, ex.id]));
  const add = () => { onAdd(chosen); onClose(); };

  const footer = (
    <>
      <Button type="button" className={btnSecondary} onClick={onClose}>Cancel</Button>
      <Button type="button" className={btnPrimary} disabled={chosen.length === 0} onClick={add}>
        {chosen.length === 0 ? 'Add exercises' : `Add ${chosen.length} ${chosen.length === 1 ? 'exercise' : 'exercises'}`}
      </Button>
    </>
  );

  return (
    <>
      <SheetDialog open={open && newName === null} wide="xl" title="Add exercises" onClose={onClose} footer={footer}>
        {!exercises ? <LoadingRows rows={4} label="Loading the Library" /> : (
          <div className="grid gap-4 desktop:grid-cols-[1fr_14rem]">
            <LibraryBrowser
              clinicId={clinic.id}
              exercises={exercises}
              usedIds={usedIds}
              selected={new Set(ticked)}
              disabledIds={disabledIds}
              onActivate={toggle}
              emptyState={<p className="py-6 text-center text-sm text-[var(--muted)]">Your Library is empty. Add exercises in the Library tab first.</p>}
              renderNoMatches={(q) => (
                <Button type="button" className={`${btnSecondary} mt-3`} disabled={!online} onClick={() => setNewName(q)}>
                  {online ? `+ New exercise “${q}”` : 'New exercises need a connection'}
                </Button>
              )}
            />
            <aside className="hidden desktop:block" aria-label="Chosen exercises">
              <div className="sticky top-0 space-y-2 rounded-xl border border-[var(--border)] p-3">
                <div className="text-sm font-semibold text-[var(--ink)]">{chosen.length === 0 ? 'Nothing chosen yet' : `${chosen.length} chosen`}</div>
                <ul className="space-y-1">
                  {chosen.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 text-sm text-[var(--ink)]">
                      <span className="truncate">{e.title}</span>
                      <button type="button" aria-label={`Remove ${e.title}`} className="text-[var(--muted)] hover:text-[var(--rust)]" onClick={() => toggle(e)}>✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        )}
      </SheetDialog>
      <ExerciseForm
        open={open && newName !== null}
        clinicId={clinic.id}
        allExercises={exercises ?? []}
        initialTitle={newName ?? ''}
        saveLabel="Save and add"
        onClose={() => setNewName(null)}
        onSaved={(_id, saved) => { onAdd([...chosen, saved]); onClose(); }}
      />
    </>
  );
}
