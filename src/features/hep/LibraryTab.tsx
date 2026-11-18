// HEP > Library: the clinic's own exercises. Browsing works offline (local cache); adding, editing and favouriting
// need a connection. The clinic starts empty: there is no built-in list (a starter set is offered, never forced).
import { useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { useEntitlements } from '@/app/useEntitlements';
import { Button } from '@/components/Button';
import { ErrorNote, LoadingRows, btnPrimary, btnSecondary } from '@/components/ui';
import { TIER_LIMITS } from '@/domain/plans';
import { db } from '@/lib/db';
import { hepService } from '@/services/hepService';
import type { Exercise } from '@/domain/hep';
import { ExerciseForm } from './ExerciseForm';
import { LibraryBrowser } from './LibraryBrowser';
import { useExerciseUseCounts, useExercises, useOnline, useUsedThisWeek } from './useHepData';

export function LibraryTab({ onStarter }: { onStarter?: () => void }) {
  const clinic = useClinic();
  const exercises = useExercises(clinic.id);
  const usedIds = useUsedThisWeek();
  const useCounts = useExerciseUseCounts();
  const online = useOnline();
  const ent = useEntitlements(clinic.id);
  const [form, setForm] = useState<{ exercise?: Exercise } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  if (!exercises) return <LoadingRows rows={4} label="Loading the Library" />;

  const cap = ent.enforcementEnabled ? TIER_LIMITS[ent.tier].exercises : null;
  const count = exercises.length;
  const archivedCount = exercises.filter((e) => !e.active).length;

  async function toggleFavorite(ex: Exercise) {
    setError(null);
    try {
      const now = await hepService.toggleExerciseFavorite(ex.id);
      await db.exercises.update(ex.id, { isFavorite: now }); // show it at once; the next sync confirms
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the favourite.');
    }
  }

  const empty = (
    <div className="space-y-3 rounded-2xl border border-dashed border-[var(--border)] p-6 text-center">
      <p className="font-display text-base font-semibold text-[var(--ink)]">Your Library is empty</p>
      <p className="mx-auto max-w-md text-sm text-[var(--muted)]">Add the exercises you prescribe most, with a photo or GIF and the usual dose. Then build a program for a patient in a minute.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" className={btnPrimary} onClick={() => setForm({})}>Add your first exercise</Button>
        {onStarter && <Button type="button" className={btnSecondary} onClick={onStarter}>Open the TheraNet Library</Button>}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-[var(--muted)]" aria-live="polite">
          {count} {count === 1 ? 'exercise' : 'exercises'}
          {cap != null && <> · free plan allows {cap}</>}
        </p>
        <div className="flex-1" />
        {archivedCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived ({archivedCount})
          </label>
        )}
        {onStarter && count > 0 && <Button type="button" className={btnSecondary} onClick={onStarter}>TheraNet Library</Button>}
        <Button type="button" className={btnPrimary} disabled={!online} onClick={() => setForm({})}>{online ? '+ Add exercise' : 'Needs a connection'}</Button>
      </div>
      <ErrorNote message={error} />
      {bulkResult && <p role="status" className="text-sm text-[var(--muted)]">{bulkResult}</p>}
      <LibraryBrowser
        clinicId={clinic.id}
        exercises={exercises}
        usedIds={usedIds}
        useCounts={useCounts}
        showArchived={showArchived}
        onActivate={(ex) => setForm({ exercise: ex })}
        onToggleFavorite={online ? (ex) => void toggleFavorite(ex) : undefined}
        selectable={{ online, onResult: setBulkResult }}
        emptyState={empty}
      />
      <ExerciseForm
        open={form !== null}
        clinicId={clinic.id}
        exercise={form?.exercise}
        allExercises={exercises}
        onClose={() => setForm(null)}
        onSaved={() => { /* the saved row arrives through the sync; the list is live */ }}
      />
    </div>
  );
}
