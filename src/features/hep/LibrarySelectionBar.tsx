// The Library's select mode bar: "{n} selected", Select all, Archive / Delete and Cancel. An exercise that programs or
// templates still use is archived, not deleted (the same rule as the exercise form); unused ones are deleted. The saves
// run one after another, because the server enforces its own guards. HEP writes need a connection.
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog, ErrorNote, btnSecondary, pillSmDanger } from '@/components/ui';
import type { Exercise } from '@/domain/hep';
import { db } from '@/lib/db';
import { hepService } from '@/services/hepService';
import { exerciseToSaveInput } from './exerciseSaveInput';

type Action = 'archive' | 'delete';
interface Plan { action: Action; remove: Exercise[]; archive: Exercise[] }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function planText(p: Plan): { title: string; message: string; confirm: string } {
  if (p.action === 'archive') {
    return { title: `Archive ${plural(p.archive.length, 'exercise', 'exercises')}?`, message: 'Archived exercises leave the Library and the picker. Existing programs keep them. You can show archived exercises again from the Library.', confirm: `Archive ${p.archive.length}` };
  }
  const parts = [p.remove.length > 0 && `Delete ${p.remove.length}`, p.archive.length > 0 && `archive ${p.archive.length}`].filter(Boolean) as string[];
  const head = parts.join(' and ');
  const confirm = [p.remove.length > 0 && `Delete ${p.remove.length}`, p.archive.length > 0 && `archive ${p.archive.length}`].filter(Boolean).join(' · ');
  return { title: `${head}?`, message: 'Exercises used in programs or templates are archived, not deleted.', confirm: confirm.charAt(0).toUpperCase() + confirm.slice(1) };
}

export function LibrarySelectionBar({ picked, shownCount, online, onSelectAll, onSelectionChange, onExit, onResult }: {
  picked: Exercise[];
  shownCount: number;
  online: boolean;
  onSelectAll: () => void;
  onSelectionChange: (ids: string[]) => void;
  onExit: () => void;
  onResult: (message: string) => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = checking || progress !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !plan && !working) onExit(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [plan, working, onExit]);

  async function prepare(action: Action) {
    setError(null);
    if (action === 'archive') {
      const archive = picked.filter((e) => e.active);
      if (archive.length === 0) { setError('These exercises are already archived.'); return; }
      setPlan({ action, remove: [], archive });
      return;
    }
    setChecking(true);
    try {
      const remove: Exercise[] = [];
      const archive: Exercise[] = [];
      for (const ex of picked) {
        const u = await hepService.exerciseUsage(ex.id);
        if (u.programs + u.templates > 0) { if (ex.active) archive.push(ex); } else remove.push(ex);
      }
      if (remove.length + archive.length === 0) setError('These exercises are already archived and still in use.');
      else setPlan({ action, remove, archive });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check where these exercises are used.');
    } finally { setChecking(false); }
  }

  async function run(p: Plan) {
    setPlan(null);
    const jobs = [...p.remove.map((ex) => ({ ex, over: { deleted: true } as const })), ...p.archive.map((ex) => ({ ex, over: { active: false } as const }))];
    const failed: string[] = [];
    let removed = 0;
    let archived = 0;
    setProgress({ done: 0, total: jobs.length });
    for (const [i, { ex, over }] of jobs.entries()) {
      try {
        await hepService.saveExercise(exerciseToSaveInput(ex, over));
        await db.exercises.update(ex.id, over).catch(() => {});
        if ('deleted' in over) removed += 1; else archived += 1;
      } catch { failed.push(ex.id); }
      setProgress({ done: i + 1, total: jobs.length });
    }
    setProgress(null);
    const done = [removed > 0 && `Deleted ${removed}`, archived > 0 && `archived ${archived}`].filter(Boolean).join(', ');
    const summary = done.charAt(0).toUpperCase() + done.slice(1);
    if (failed.length > 0) {
      onSelectionChange(failed);
      setError(`${summary ? `${summary}. ` : ''}${failed.length} could not be changed and ${failed.length === 1 ? 'is' : 'are'} still selected. Try again.`);
      if (summary) onResult(summary);
    } else {
      onResult(summary);
      onExit();
    }
  }

  const disabled = !online || picked.length === 0 || working;
  const title = online ? undefined : 'Needs a connection';
  const text = plan ? planText(plan) : null;

  return (
    <>
      <div role="region" aria-label="Bulk actions" className="sticky bottom-2 z-10 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[var(--ink)]" aria-live="polite">{picked.length} selected</span>
          <Button type="button" className="min-h-11 rounded-lg px-2 text-sm font-medium text-[var(--teal)]" disabled={working} onClick={onSelectAll}>Select all {shownCount} shown</Button>
          <div className="flex-1" />
          {progress && <span className="text-sm text-[var(--muted)]" role="status">Working {Math.min(progress.done + 1, progress.total)} of {progress.total}…</span>}
          <Button type="button" className={btnSecondary} disabled={disabled} title={title} onClick={() => void prepare('archive')}>Archive</Button>
          <Button type="button" className={pillSmDanger} disabled={disabled} title={title} onClick={() => void prepare('delete')}>Delete</Button>
          <Button type="button" className={btnSecondary} disabled={working} onClick={onExit}>Cancel</Button>
        </div>
        <ErrorNote message={error} />
      </div>
      <ConfirmDialog
        open={plan !== null} title={text?.title ?? ''} message={text?.message ?? ''} confirmLabel={text?.confirm ?? 'Confirm'} destructive
        onConfirm={() => { if (plan) void run(plan); }} onCancel={() => setPlan(null)}
      />
    </>
  );
}
