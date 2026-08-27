import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { repos, consultationNoteService } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import {
  emptySessionPayload,
  upcastSessionPayload,
  type SessionNotePayload,
} from '@/domain/sessionNote';
import type { Patient, Therapist } from '@/domain/types';

export interface UseSessionNoteEditorArgs {
  patientId: string;
  /** The visit this note documents. For the single-visit editor this is the
   *  `visitId` search param; for the batch editor, the queue's current
   *  visit id. */
  visitId: string | null;
  /** A known note id — set when arriving via the mode-dispatched
   *  `/notes/$noteId` route (single-visit editor only). The batch editor
   *  never passes this; it always resolves per-visit via `getOpenDraft`. */
  noteId?: string;
  /** Fires once when this hook determines the durable note id for the
   *  current visit — either an already-open draft found on init, or the
   *  id from this session's first successful save. Callers that need a
   *  stable per-note URL (the single-visit editor) use this to navigate;
   *  the batch editor uses it to remember which note belongs to which
   *  queued visit, for revisiting via Prev. */
  onNoteIdResolved?: (noteId: string) => void;
  /** Fires after an explicit Save (draft or complete) persists
   *  successfully — never after a background autosave. */
  onSaved: () => void;
}

export interface SessionNoteEditor {
  ready: boolean;
  patient: Patient | undefined;
  therapists: Therapist[] | undefined;
  canViewClinicalNotes: boolean;
  therapistId: string;
  setTherapistId: (id: string) => void;
  payload: SessionNotePayload;
  update: <K extends keyof SessionNotePayload>(key: K, value: SessionNotePayload[K]) => void;
  status: 'draft' | 'completed';
  readOnly: boolean;
  busy: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  saveIndicator: 'saved' | 'saving' | 'unsaved';
  save: (nextStatus: 'draft' | 'completed') => Promise<void>;
}

/**
 * All the state/effects/persistence behind the light per-session SOAP
 * editor, extracted out of SessionNoteEditorPage.tsx so both the
 * single-visit route and the batch (Save & Next) flow mount the same
 * logic instead of two copies of it — see Billing & Notes Rebuild Phase 3
 * plan. Callers own routing/navigation entirely via `onNoteIdResolved`/
 * `onSaved`; this hook never calls `navigate` itself.
 */
export function useSessionNoteEditor({
  patientId,
  visitId,
  noteId,
  onNoteIdResolved,
  onSaved,
}: UseSessionNoteEditorArgs): SessionNoteEditor {
  const clinic = useClinic();
  const { canViewClinicalNotes } = usePermissions();

  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id), [clinic.id]);
  const existingNote = useLiveQuery(
    () => (noteId ? repos.consultationNotes.get(noteId) : Promise.resolve(undefined)),
    [noteId]
  );

  const linkedVisitId = existingNote?.visitId ?? visitId ?? null;
  const linkedVisit = useLiveQuery(
    () => (linkedVisitId ? repos.visits.get(linkedVisitId) : undefined),
    [linkedVisitId]
  );

  const [therapistId, setTherapistId] = useState('');
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null);
  const [payload, setPayload] = useState<SessionNotePayload>(emptySessionPayload(''));
  const [status, setStatus] = useState<'draft' | 'completed'>('draft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [persistedNoteId, setPersistedNoteId] = useState<string | undefined>(noteId);
  const [saveIndicator, setSaveIndicator] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosavingRef = useRef(false);

  // Same "don't clobber an in-progress edit" guard NoteEditorPage uses:
  // once this exact note has been hydrated once, a later live-query
  // emission (a sync pull, the same note open elsewhere) must not
  // re-overwrite unsaved local edits.
  const hydratedNoteIdRef = useRef<string | null>(null);

  // Dedupes onNoteIdResolved so it fires exactly once per note id, not on
  // every autosave tick once a note already has one.
  const notifiedNoteIdRef = useRef<string | null>(noteId ?? null);
  const notifyNoteId = useCallback(
    (id: string) => {
      if (notifiedNoteIdRef.current === id) return;
      notifiedNoteIdRef.current = id;
      onNoteIdResolved?.(id);
    },
    [onNoteIdResolved]
  );

  useEffect(() => {
    if (therapistId) return;
    if (linkedVisit) setTherapistId(linkedVisit.therapistId);
    else if (therapists && therapists.length > 0) setTherapistId(therapists[0].id);
  }, [therapistId, linkedVisit, therapists]);

  const savedSnapshotRef = useRef<string>(JSON.stringify(emptySessionPayload('')));
  const isDirtyRef = useRef(false);
  useEffect(() => {
    isDirtyRef.current = JSON.stringify(payload) !== savedSnapshotRef.current;
    if (ready && status !== 'completed' && isDirtyRef.current) {
      setSaveIndicator((prev) => (prev === 'saving' ? prev : 'unsaved'));
    }
  }, [payload, ready, status]);

  useBlocker({
    shouldBlockFn: () => {
      if (!isDirtyRef.current) return false;
      return !confirm('You have unsaved changes on this note. Leave without saving?');
    },
    enableBeforeUnload: () => isDirtyRef.current,
  });

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (noteId) {
        if (hydratedNoteIdRef.current === noteId) return;
        if (!existingNote) return; // still resolving
        hydratedNoteIdRef.current = noteId;
        setEnrollmentId(existingNote.enrollmentId);
        setStatus(existingNote.status === 'completed' ? 'completed' : 'draft');
        setTherapistId(existingNote.therapistId);
        setPersistedNoteId(existingNote.id);
        if (existingNote.assessmentPayload) {
          const hydrated = upcastSessionPayload(existingNote.assessmentPayload);
          setPayload(hydrated);
          savedSnapshotRef.current = JSON.stringify(hydrated);
        }
        setSaveIndicator('saved');
        setReady(true);
        return;
      }
      const openDraft = await repos.consultationNotes.getOpenDraft(
        clinic.id,
        patientId,
        ['session'],
        visitId ?? null
      );
      if (openDraft) {
        if (cancelled) return;
        hydratedNoteIdRef.current = openDraft.id;
        setEnrollmentId(openDraft.enrollmentId);
        setStatus(openDraft.status === 'completed' ? 'completed' : 'draft');
        setTherapistId(openDraft.therapistId);
        setPersistedNoteId(openDraft.id);
        if (openDraft.assessmentPayload) {
          const hydrated = upcastSessionPayload(openDraft.assessmentPayload);
          setPayload(hydrated);
          savedSnapshotRef.current = JSON.stringify(hydrated);
        }
        setSaveIndicator('saved');
        setReady(true);
        notifyNoteId(openDraft.id);
        return;
      }
      const enrollment = await consultationNoteService.getOrCreateActiveEnrollment(
        clinic.id,
        patientId
      );
      if (cancelled) return;
      setEnrollmentId(enrollment.id);
      const fresh = emptySessionPayload(enrollment.id);
      setPayload(fresh);
      savedSnapshotRef.current = JSON.stringify(fresh);
      setReady(true);
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [noteId, existingNote, clinic.id, patientId, visitId, notifyNoteId]);

  const persistDraft = useCallback(
    async (options: { nextStatus: 'draft' | 'completed'; explicit: boolean }) => {
      const { nextStatus, explicit } = options;
      if (!enrollmentId || !therapistId) return false;
      if (explicit) {
        setBusy(true);
      } else {
        autosavingRef.current = true;
        setSaveIndicator('saving');
      }
      setError(null);
      try {
        const saved = await consultationNoteService.saveSessionNote(
          {
            id: persistedNoteId ?? existingNote?.id,
            clinicId: clinic.id,
            patientId,
            therapistId,
            visitId: existingNote?.visitId ?? visitId ?? null,
            enrollmentId,
            authorizedSessionCount: null,
          },
          payload,
          nextStatus
        );
        setPersistedNoteId(saved.id);
        hydratedNoteIdRef.current = saved.id;
        savedSnapshotRef.current = JSON.stringify(payload);
        isDirtyRef.current = false;
        setSaveIndicator('saved');
        notifyNoteId(saved.id);
        if (explicit) {
          onSaved();
        }
        return true;
      } catch (e) {
        if (explicit) {
          setError(toFriendlyMessage(e));
        } else {
          setSaveIndicator('unsaved');
        }
        return false;
      } finally {
        if (explicit) {
          setBusy(false);
        } else {
          autosavingRef.current = false;
        }
      }
    },
    [
      enrollmentId,
      therapistId,
      payload,
      persistedNoteId,
      existingNote?.id,
      existingNote?.visitId,
      clinic.id,
      patientId,
      visitId,
      notifyNoteId,
      onSaved,
    ]
  );

  useEffect(() => {
    if (!ready || status === 'completed' || !enrollmentId || !therapistId) return;
    if (!isDirtyRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void persistDraft({ nextStatus: 'draft', explicit: false });
    }, 2500);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [payload, ready, status, enrollmentId, therapistId, persistDraft]);

  const save = useCallback(
    async (nextStatus: 'draft' | 'completed') => {
      await persistDraft({ nextStatus, explicit: true });
    },
    [persistDraft]
  );

  function update<K extends keyof SessionNotePayload>(key: K, value: SessionNotePayload[K]) {
    setPayload((p) => ({ ...p, [key]: value }));
  }

  return {
    ready,
    patient,
    therapists,
    canViewClinicalNotes,
    therapistId,
    setTherapistId,
    payload,
    update,
    status,
    readOnly: status === 'completed',
    busy,
    error,
    setError,
    saveIndicator,
    save,
  };
}
