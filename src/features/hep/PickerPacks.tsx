// The picker's Templates and "earlier programs" tabs: cards that add a whole set of exercises in one tap.
import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { filterChip, btnPrimary } from '@/components/ui';
import { canonicalRegion, listThumbKey, type Exercise } from '@/domain/hep';
import { Thumb } from './LibraryParts';
import { useThumbUrls } from './useHepData';

export interface Pack {
  id: string;
  title: string;
  /** "3 exercises · used 2×" or a date line. */
  meta: string;
  exercises: Array<{ title: string; sourceExerciseId?: string | null; bodyRegion: string }>;
  /** How many of its exercises are not yet in the program. */
  addable: number;
}

export function PackList({ clinicId, packs, library, regionChips, empty, onAddAll }: {
  clinicId: string;
  packs: Pack[];
  library: Exercise[];
  regionChips?: boolean;
  empty: string;
  onAddAll: (pack: Pack) => void;
}) {
  const [region, setRegion] = useState('All');
  const byId = useMemo(() => new Map(library.map((e) => [e.id, e])), [library]);
  const regions = useMemo(() => [...new Set(packs.flatMap((p) => p.exercises.map((e) => canonicalRegion(e.bodyRegion))).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [packs]);
  const shown = packs.filter((p) => region === 'All' || p.exercises.some((e) => canonicalRegion(e.bodyRegion) === region));
  const pictured = useMemo(() => shown.flatMap((p) => p.exercises.slice(0, 5).map((e) => (e.sourceExerciseId ? byId.get(e.sourceExerciseId) : undefined)).filter((e): e is Exercise => !!e)), [shown, byId]);
  const thumbs = useThumbUrls(clinicId, pictured);

  if (packs.length === 0) return <p className="py-6 text-center text-sm text-[var(--muted)]">{empty}</p>;
  return (
    <div className="space-y-3">
      {regionChips && regions.length > 1 && (
        <div role="group" aria-label="Template region" className="flex gap-1.5 overflow-x-auto pb-1">
          {['All', ...regions].map((r) => <button key={r} type="button" aria-pressed={region === r} className={`${filterChip(region === r)} shrink-0`} onClick={() => setRegion(r)}>{r}</button>)}
        </div>
      )}
      <ul className="grid grid-cols-1 gap-2 @[600px]:grid-cols-2">
        {shown.map((p) => (
          <li key={p.id} className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="font-display text-sm font-semibold text-[var(--ink)]">{p.title}</div>
            <div className="flex gap-1.5" aria-hidden="true">
              {p.exercises.slice(0, 5).map((e, i) => {
                const src = e.sourceExerciseId ? byId.get(e.sourceExerciseId) : undefined;
                const tk = src ? listThumbKey(src) : null;
                return src ? <Thumb key={i} ex={src} url={tk ? thumbs[tk] : undefined} size={40} /> : null;
              })}
            </div>
            <p className="line-clamp-2 text-xs text-[var(--muted)]">{p.exercises.map((e) => e.title).join(', ')}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--muted)]">{p.meta}</span>
              <Button type="button" className={`${btnPrimary} !min-h-9 !px-3`} disabled={p.addable === 0} onClick={() => onAddAll(p)}>Add all {p.addable}</Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
