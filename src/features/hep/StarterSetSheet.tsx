// Library > Starter library: tick the exercises to copy into the clinic's own Library. Optional, never automatic.
// Exercises the clinic already has (same name) are shown but not offered again. The free plan's cap is enforced by the
// server: if it is hit part-way, what was added stays and the message says how many.
import { useEffect, useMemo, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { Button } from '@/components/Button';
import { SheetDialog, btnPrimary, btnSecondary } from '@/components/ui';
import { HEP_BODY_ORDER, canonicalRegion } from '@/domain/hep';
import { doseSummary } from '@/domain/hepDose';
import { STARTER_EXERCISES, type StarterExercise } from '@/domain/hepStarterSet';
import { db } from '@/lib/db';
import { HEP_NEEDS_CONNECTION, hepService } from '@/services/hepService';
import { exerciseFromSaveInput, starterToSaveInput } from './starterSet';
import { useExercises, useOnline } from './useHepData';

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');

export function StarterSetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const clinic = useClinic();
  const online = useOnline();
  const exercises = useExercises(clinic.id);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setTicked(new Set()); setError(null); setBusy(false); } }, [open]);

  const have = useMemo(() => new Set((exercises ?? []).map((e) => squash(e.title))), [exercises]);
  const offered = (s: StarterExercise) => !have.has(squash(s.title));
  const groups = useMemo(() => {
    const order = (r: string) => { const i = (HEP_BODY_ORDER as readonly string[]).indexOf(r); return i === -1 ? 99 : i; };
    const byRegion = new Map<string, StarterExercise[]>();
    for (const s of STARTER_EXERCISES) byRegion.set(canonicalRegion(s.region), [...(byRegion.get(canonicalRegion(s.region)) ?? []), s]);
    return [...byRegion.entries()].sort(([a], [b]) => order(a) - order(b));
  }, []);

  const toggle = (title: string) => setTicked((cur) => { const n = new Set(cur); if (n.has(title)) n.delete(title); else n.add(title); return n; });
  const toggleRegion = (list: StarterExercise[]) => setTicked((cur) => {
    const n = new Set(cur);
    const free = list.filter(offered);
    const allOn = free.every((s) => n.has(s.title));
    for (const s of free) { if (allOn) n.delete(s.title); else n.add(s.title); }
    return n;
  });

  async function add() {
    if (!online) { setError(HEP_NEEDS_CONNECTION); return; }
    const chosen = STARTER_EXERCISES.filter((s) => ticked.has(s.title) && offered(s));
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: chosen.length });
    let added = 0;
    try {
      for (const s of chosen) {
        const input = starterToSaveInput(clinic.id, s);
        const id = await hepService.saveExercise(input);
        await db.exercises.put(exerciseFromSaveInput(input, id)).catch(() => {});
        added += 1;
        setProgress({ done: added, total: chosen.length });
      }
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not add the exercises.';
      setError(added > 0 ? `Added ${added} of ${chosen.length}. ${message}` : message);
      setTicked(new Set(chosen.slice(added).map((s) => s.title)));
    } finally {
      setBusy(false);
    }
  }

  const count = [...ticked].filter((t) => STARTER_EXERCISES.some((s) => s.title === t && offered(s))).length;
  return (
    <SheetDialog
      open={open}
      title="Starter library"
      onClose={onClose}
      busy={busy}
      error={error}
      footer={
        <>
          <Button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" className={btnPrimary} onClick={() => void add()} disabled={busy || count === 0 || !online}>
            {busy ? `Adding ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : !online ? 'Needs a connection' : count === 0 ? 'Add exercises' : `Add ${count} ${count === 1 ? 'exercise' : 'exercises'}`}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-[var(--muted)]">Ready-made exercises with simple steps and a usual dose. They are copied into your own Library, where you can change anything and add photos. Pick only what you want.</p>
      <div className="space-y-4">
        {groups.map(([region, list]) => {
          const free = list.filter(offered);
          const allOn = free.length > 0 && free.every((s) => ticked.has(s.title));
          return (
            <section key={region} aria-label={region} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-[var(--ink)]">{region}</h3>
                {free.length > 0 && <Button type="button" className="text-xs font-medium text-[var(--teal)]" onClick={() => toggleRegion(list)}>{allOn ? 'Clear' : `Select all (${free.length})`}</Button>}
              </div>
              <ul className="space-y-1">
                {list.map((s) => {
                  const mine = !offered(s);
                  return (
                    <li key={s.title}>
                      <label className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${mine ? 'opacity-50' : 'hover:bg-[var(--paper)]'}`}>
                        <input type="checkbox" className="mt-1" disabled={mine} checked={mine || ticked.has(s.title)} onChange={() => toggle(s.title)} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-[var(--ink)]">{s.title}{mine && <span className="ml-2 text-xs font-normal text-[var(--muted)]">Already in your Library</span>}</span>
                          <span className="block text-xs text-[var(--muted)]">{doseSummary({ doseType: s.dose.kind, defaultSets: s.dose.sets, defaultReps: s.dose.reps ?? null, defaultHoldSeconds: s.dose.holdSeconds ?? null, defaultDurationSeconds: s.dose.durationSeconds ?? null, defaultRestSeconds: s.dose.restSeconds, side: s.dose.side, defaultSessionsPerDay: s.dose.perDay })}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </SheetDialog>
  );
}
