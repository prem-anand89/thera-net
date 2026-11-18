// Library > TheraNet Library: tick the exercises to copy into the clinic's own Library. Optional, never automatic.
// Reads from the shared `starter_exercises` catalog curated by Beyond Mechanics & Physio Clinic (falling back offline or
// pre-migration to the static STARTER_EXERCISES list), and clones any Starter pictures into the clinic's R2 prefix.
// Exercises the clinic already has (same name) are shown but not offered again.
import { useEffect, useMemo, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { Button } from '@/components/Button';
import { SheetDialog, btnPrimary, btnSecondary } from '@/components/ui';
import {
  HEP_BODY_ORDER,
  canonicalRegion,
  listThumbKey,
  type Exercise,
  type StarterLibraryItem,
} from '@/domain/hep';
import { doseSummary } from '@/domain/hepDose';
import { db } from '@/lib/db';
import { hepMediaService } from '@/services/hepMediaService';
import { HEP_NEEDS_CONNECTION, hepService } from '@/services/hepService';
import { starterLibraryService, staticStarterItems } from '@/services/starterLibraryService';
import { Thumb } from './LibraryParts';
import { exerciseFromSaveInput, starterItemToSaveInput } from './starterSet';
import { useExercises, useOnline } from './useHepData';

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');

function asThumbExercise(item: StarterLibraryItem): Exercise {
  return {
    id: item.id, clinicId: 'starter', title: item.title, otherNames: item.otherNames,
    bodyRegion: item.bodyRegion, alsoRegions: item.alsoRegions, phase: item.phase, alsoPhases: item.alsoPhases,
    positions: item.positions, equipment: item.equipment, instructions: item.instructions, stopIf: item.stopIf,
    mediaType: item.mediaType, mediaKeys: item.mediaKeys, mediaCaptions: item.mediaCaptions, thumbKey: item.thumbKey,
    defaultSets: item.defaultSets, doseType: item.doseType, defaultReps: item.defaultReps,
    defaultHoldSeconds: item.defaultHoldSeconds, defaultDurationSeconds: item.defaultDurationSeconds,
    defaultRestSeconds: item.defaultRestSeconds, defaultSessionsPerDay: item.defaultSessionsPerDay,
    side: item.side, isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '',
  };
}

export function StarterSetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const clinic = useClinic();
  const online = useOnline();
  const exercises = useExercises(clinic.id);
  const [items, setItems] = useState<StarterLibraryItem[]>(() => staticStarterItems());
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTicked(new Set());
    setError(null);
    setBusy(false);
    let live = true;
    void starterLibraryService.listStarterItems().then((list) => {
      if (!live) return;
      setItems(list);
      const keys = [...new Set(list.map((s) => listThumbKey(s)).filter((k): k is string => !!k))];
      if (keys.length > 0 && online) {
        void hepMediaService.mintStarterViewUrls(clinic.id, keys).then((urls) => {
          if (live) setThumbUrls(urls);
        }).catch(() => {});
      }
    });
    return () => { live = false; };
  }, [open, online, clinic.id]);

  const have = useMemo(() => new Set((exercises ?? []).map((e) => squash(e.title))), [exercises]);
  const offered = (s: StarterLibraryItem) => !have.has(squash(s.title));
  const groups = useMemo(() => {
    const order = (r: string) => { const i = (HEP_BODY_ORDER as readonly string[]).indexOf(r); return i === -1 ? 99 : i; };
    const byRegion = new Map<string, StarterLibraryItem[]>();
    for (const s of items) byRegion.set(canonicalRegion(s.bodyRegion), [...(byRegion.get(canonicalRegion(s.bodyRegion)) ?? []), s]);
    return [...byRegion.entries()].sort(([a], [b]) => order(a) - order(b));
  }, [items]);

  const toggle = (title: string) => setTicked((cur) => { const n = new Set(cur); if (n.has(title)) n.delete(title); else n.add(title); return n; });
  const toggleRegion = (list: StarterLibraryItem[]) => setTicked((cur) => {
    const n = new Set(cur);
    const free = list.filter(offered);
    const allOn = free.every((s) => n.has(s.title));
    for (const s of free) { if (allOn) n.delete(s.title); else n.add(s.title); }
    return n;
  });

  async function add() {
    if (!online) { setError(HEP_NEEDS_CONNECTION); return; }
    const chosen = items.filter((s) => ticked.has(s.title) && offered(s));
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: chosen.length });
    let added = 0;
    try {
      for (const s of chosen) {
        const newId = crypto.randomUUID();
        const cloned = s.mediaKeys.length > 0
          ? await hepMediaService.cloneFromStarter(clinic.id, newId, s.mediaKeys, s.thumbKey)
          : { mediaKeys: [], thumbKey: null };
        const input = starterItemToSaveInput(clinic.id, s, newId, cloned);
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

  const count = [...ticked].filter((t) => items.some((s) => s.title === t && offered(s))).length;
  return (
    <SheetDialog
      open={open}
      title="TheraNet Library"
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
                  const tk = listThumbKey(s);
                  const url = tk ? thumbUrls[tk] : undefined;
                  return (
                    <li key={s.id}>
                      <label className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${mine ? 'opacity-50' : 'hover:bg-[var(--paper)]'}`}>
                        <input type="checkbox" className="shrink-0" disabled={mine} checked={mine || ticked.has(s.title)} onChange={() => toggle(s.title)} />
                        {url && <Thumb ex={asThumbExercise(s)} url={url} size={36} />}
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-[var(--ink)]">{s.title}{mine && <span className="ml-2 text-xs font-normal text-[var(--muted)]">Already in your Library</span>}</span>
                          <span className="block text-xs text-[var(--muted)]">{doseSummary(s)}</span>
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
