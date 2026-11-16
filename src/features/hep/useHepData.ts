// Small data hooks shared by the HEP screens. Reading the Library works offline (Dexie); everything that needs the
// server (thumbnails, "used this week", templates, programs) fails quietly or says "needs a connection".
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { clinicTimezone } from '@/domain/clinicRegion';
import { addDaysISO, type Exercise } from '@/domain/hep';
import { db } from '@/lib/db';
import { hepMediaService } from '@/services/hepMediaService';
import { hepService, type ProgramBundle } from '@/services/hepService';

const PROGRAMS_WINDOW_DAYS = 14;

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
}
/** True while the browser believes it is online. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** The clinic's own today (YYYY-MM-DD), not the device's. */
export function clinicToday(clinic: { timezone?: string | null }, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: clinicTimezone(clinic), year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Every exercise of the clinic in the offline cache, archived ones included (screens filter). undefined while loading. */
export function useExercises(clinicId: string): Exercise[] | undefined {
  return useLiveQuery(() => db.exercises.where('clinicId').equals(clinicId).filter((e) => !e.deleted).toArray(), [clinicId]);
}

/** Ids of exercises prescribed in the last 7 days. Empty while offline or loading. */
export function useUsedThisWeek(): ReadonlySet<string> {
  const clinic = useClinic();
  const online = useOnline();
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!online) return;
    let live = true;
    hepService.recentlyUsedExerciseIds(clinic.id, addDaysISO(clinicToday(clinic), -7)).then((list) => { if (live) setIds(new Set(list)); }).catch(() => {});
    return () => { live = false; };
  }, [clinic, online]);
  return ids;
}

/** How many times each exercise has been prescribed. {} while offline or loading (sorting then falls back to A to Z). */
export function useExerciseUseCounts(): Record<string, number> {
  const clinic = useClinic();
  const online = useOnline();
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!online) { setCounts({}); return; }
    let live = true;
    Promise.resolve().then(() => hepService.exerciseUseCounts(clinic.id)).then((c) => { if (live) setCounts(c ?? {}); }).catch(() => {});
    return () => { live = false; };
  }, [clinic.id, online]);
  return counts;
}

const THUMB_TTL_MS = 20 * 60 * 1000; // the signer keeps one link for 30 minutes and it is valid for 60
const thumbCache = new Map<string, { url: string; at: number }>();

/** Signed thumbnail links for the given exercises. An exercise with "Hide pictures in lists" never gets one. */
export function useThumbUrls(clinicId: string, exercises: Exercise[]): Record<string, string> {
  const online = useOnline();
  const keys = useMemo(
    () => [...new Set(exercises.filter((e) => e.thumbKey && !e.hidePicturesInLists).map((e) => e.thumbKey as string))],
    [exercises],
  );
  const wanted = keys.join('|');
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const fresh = (k: string) => { const c = thumbCache.get(k); return c && Date.now() - c.at < THUMB_TTL_MS ? c.url : null; };
    const pick = () => Object.fromEntries(keys.flatMap((k) => { const u = fresh(k); return u ? [[k, u]] : []; }));
    setUrls(pick());
    const missing = keys.filter((k) => !fresh(k));
    if (!online || missing.length === 0) return;
    let live = true;
    hepMediaService.mintViewUrls(clinicId, missing).then((minted) => {
      for (const [k, url] of Object.entries(minted)) thumbCache.set(k, { url, at: Date.now() });
      if (live) setUrls(pick());
    }).catch(() => { /* no pictures this time: rows show their text tile */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, wanted, online]);
  return urls;
}

/** Shared clinic-wide HEP programs load for HepPage pill counts and ProgramsTab. */
export function useClinicPrograms(
  clinic: { id: string; timezone?: string | null },
  { enabled, reloadKey = 0 }: { enabled: boolean; reloadKey?: number },
): { bundles: ProgramBundle[] | null; error: string | null; reload: () => Promise<void> } {
  const online = useOnline();
  const [bundles, setBundles] = useState<ProgramBundle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [painVersion, setPainVersion] = useState(0);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const onReviewed = () => setPainVersion((v) => v + 1);
    window.addEventListener('hep:pain-reviewed', onReviewed);
    return () => window.removeEventListener('hep:pain-reviewed', onReviewed);
  }, []);

  const reload = useCallback(async () => {
    if (!enabled || !online) return;
    const id = ++reqIdRef.current;
    const windowStart = addDaysISO(clinicToday(clinic), -PROGRAMS_WINDOW_DAYS);
    try {
      setError(null);
      const list = await Promise.resolve().then(() => hepService.listClinicPrograms(clinic.id, windowStart));
      if (reqIdRef.current === id) setBundles(list);
    } catch (e) {
      if (reqIdRef.current !== id) return;
      setError(e instanceof Error ? e.message : 'Could not load the programs.');
      setBundles((cur) => cur ?? []);
    }
  }, [clinic, enabled, online]);

  useEffect(() => {
    if (!enabled) {
      reqIdRef.current += 1;
      setBundles(null);
      setError(null);
      return;
    }
    if (!online) return;
    void reload();
  }, [enabled, online, reload, reloadKey, painVersion]);

  return { bundles, error, reload };
}
