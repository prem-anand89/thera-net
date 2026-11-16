// Lightweight clinic-wide HEP nav signal: true while at least one non-completed program in the clinic has an
// unreviewed pain 7+ report. Shared across Shell and MorePage via a tiny module store so only one query runs,
// refreshing on 'hep:pain-reviewed', on window focus/visibility (60 s throttle), and every 5 min while visible.
import { useEffect, useId, useSyncExternalStore } from 'react';
import { hepService } from '@/services/hepService';
import { hasClinicPainAlert } from './programRows';
import { useOnline } from './useHepData';

const PAIN_REVIEWED_EVENT = 'hep:pain-reviewed';
const FOCUS_THROTTLE_MS = 60_000;
const POLL_INTERVAL_MS = 5 * 60_000;

interface Consumer {
  clinicId?: string;
  enabled: boolean;
}

const consumers = new Map<string, Consumer>();
const listeners = new Set<() => void>();
let snapshot: { clinicId: string | null; dot: boolean } = { clinicId: null, dot: false };
let lastCheckedAt = 0;
let seq = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let listenersAttached = false;

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

function activeClinicId(): string | null {
  for (const c of consumers.values()) {
    if (c.enabled && c.clinicId) return c.clinicId;
  }
  return null;
}

function isTabVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

async function runCheck(force: boolean) {
  const clinicId = activeClinicId();
  if (!clinicId || !navigator.onLine) return;
  const now = Date.now();
  if (!force && snapshot.clinicId === clinicId && now - lastCheckedAt < FOCUS_THROTTLE_MS) return;

  if (snapshot.clinicId !== clinicId) {
    snapshot = { clinicId, dot: false };
    emit();
  }
  lastCheckedAt = now;
  const mySeq = ++seq;
  try {
    const list = await Promise.resolve().then(() => hepService.listPainAlerts(clinicId));
    if (seq !== mySeq) return;
    if (snapshot.clinicId !== clinicId || snapshot.dot !== hasClinicPainAlert(list)) {
      snapshot = { clinicId, dot: hasClinicPainAlert(list) };
      emit();
    }
  } catch {
    if (seq !== mySeq) return;
    // Preserve last known dot on transient background check failures.
  }
}

function handleReviewed() {
  void runCheck(true);
}

function handleFocusOrVisible() {
  if (!isTabVisible()) return;
  void runCheck(false);
}

function handleOnline() {
  void runCheck(true);
}

function syncLifecycle() {
  const clinicId = activeClinicId();
  if (!clinicId) {
    seq += 1;
    lastCheckedAt = 0;
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (listenersAttached && typeof window !== 'undefined') {
      window.removeEventListener(PAIN_REVIEWED_EVENT, handleReviewed);
      window.removeEventListener('focus', handleFocusOrVisible);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
      listenersAttached = false;
    }
    if (snapshot.clinicId !== null || snapshot.dot) {
      snapshot = { clinicId: null, dot: false };
      emit();
    }
    return;
  }

  if (!listenersAttached && typeof window !== 'undefined') {
    window.addEventListener(PAIN_REVIEWED_EVENT, handleReviewed);
    window.addEventListener('focus', handleFocusOrVisible);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleFocusOrVisible);
    listenersAttached = true;
  }
  if (pollTimer === null) {
    pollTimer = setInterval(() => {
      if (isTabVisible() && navigator.onLine && activeClinicId()) {
        void runCheck(true);
      }
    }, POLL_INTERVAL_MS);
  }

  if (snapshot.clinicId !== clinicId) {
    void runCheck(true);
  }
}

export function useHepPainDot(clinicId: string | undefined, enabled: boolean): boolean {
  const online = useOnline();
  const id = useId();
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    consumers.set(id, { clinicId, enabled });
    syncLifecycle();
    return () => {
      consumers.delete(id);
      syncLifecycle();
    };
  }, [id, clinicId, enabled]);

  if (!enabled || !online || !clinicId || state.clinicId !== clinicId) return false;
  return state.dot;
}
