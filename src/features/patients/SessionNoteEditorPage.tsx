import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { PatientProfileBackTarget } from '@/app/router';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { ScaleWidget } from '@/components/ScaleWidget';
import { MultiToggle, SingleToggle } from '@/components/ui';
import { repos, consultationNoteService } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { SESSION_INTERVENTION_OPTIONS } from '@/domain/treatmentOptions';
import {
  emptySessionPayload,
  upcastSessionPayload,
  SESSION_ASSESSMENT_OPTIONS,
  SESSION_PLAN_OPTIONS,
  type SessionNotePayload,
} from '@/domain/sessionNote';

/**
 * Light per-session SOAP note editor — /patients/$patientId/notes/new-session
 * (no note yet) and, via the mode-dispatched /notes/$noteId, an existing
 * session draft/completed note. Deliberately a small single-screen form,
 * not built on NoteEditorPage's accordion/jump-nav machinery — 5 fields vs.
 * ~40+. See Billing & Notes Rebuild Phase 2 plan for C4's field list and
 * why this stays intentionally minimal: every stakeholder will want one
 * more field on it, and past one screen this rebuilds the problem it set
 * out to solve.
 */
export function SessionNoteEditorPage() {
  const clinic = useClinic();
  const navigate = useNavigate();
  const { canViewClinicalNotes } = usePermissions();
  const { patientId, noteId } = useParams({ strict: false }) as {
    patientId: string;
    noteId?: string;
  };
  const { visitId: promptedVisitId, from: backTo } = useSearch({ strict: false }) as {
    visitId?: string;
    from?: PatientProfileBackTarget;
  };

  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id), [clinic.id]);
  const existingNote = useLiveQuery(
    () => (noteId ? repos.consultationNotes.get(noteId) : Promise.resolve(undefined)),
    [noteId]
  );

  const linkedVisitId = existingNote?.visitId ?? promptedVisitId ?? null;
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
        promptedVisitId ?? null
      );
      if (openDraft) {
        if (cancelled) return;
        void navigate({
          to: '/patients/$patientId/notes/$noteId',
          params: { patientId, noteId: openDraft.id },
          replace: true,
          search: {
            ...(promptedVisitId ? { visitId: promptedVisitId } : {}),
            ...(backTo ? { from: backTo } : {}),
          },
        });
        return;
      }
      const enrollment = await consultationNoteService.getOrCreateActiveEnrollment(
        clinic.id,
        patientId
      );
      if (cancelled) return;
      // Defensive re-check, not the real gate — the real gate is whether
      // the "+ Note" link that brought a visitor here offered this route
      // at all (VisitNoteLink, gated on sessionNotesAllowed). A direct URL
      // visit could still land here without that check ever running, so
      // this route re-checks client-side and bounces to the heavy editor
      // with the same banner a gated link would have shown — a UI hint,
      // not a security boundary (the real boundary is server-side RLS).
      const allowed = await consultationNoteService.sessionNotesAllowed(enrollment.id);
      if (!allowed) {
        if (cancelled) return;
        void navigate({
          to: '/patients/$patientId/notes/new',
          params: { patientId },
          replace: true,
          search: {
            reason: 'needs-initial',
            ...(promptedVisitId ? { visitId: promptedVisitId } : {}),
            ...(backTo ? { from: backTo } : {}),
          },
        });
        return;
      }
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
  }, [noteId, existingNote, clinic.id, patientId, navigate, promptedVisitId, backTo]);

  const persistDraft = useCallback(
    async (options: { nextStatus: 'draft' | 'completed'; navigateAway: boolean }) => {
      const { nextStatus, navigateAway } = options;
      if (!enrollmentId || !therapistId) return false;
      if (navigateAway) {
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
            visitId: existingNote?.visitId ?? promptedVisitId ?? null,
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
        if (!noteId && saved.id) {
          void navigate({
            to: '/patients/$patientId/notes/$noteId',
            params: { patientId, noteId: saved.id },
            replace: true,
            search: {
              ...(promptedVisitId ? { visitId: promptedVisitId } : {}),
              ...(backTo ? { from: backTo } : {}),
            },
          });
        }
        if (navigateAway) {
          navigate({
            to: '/patients/$patientId',
            params: { patientId },
            search: backTo ? { from: backTo } : undefined,
          });
        }
        return true;
      } catch (e) {
        if (navigateAway) {
          setError(toFriendlyMessage(e));
        } else {
          setSaveIndicator('unsaved');
        }
        return false;
      } finally {
        if (navigateAway) {
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
      promptedVisitId,
      noteId,
      navigate,
      backTo,
    ]
  );

  useEffect(() => {
    if (!ready || status === 'completed' || !enrollmentId || !therapistId) return;
    if (!isDirtyRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void persistDraft({ nextStatus: 'draft', navigateAway: false });
    }, 2500);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [payload, ready, status, enrollmentId, therapistId, persistDraft]);

  async function save(nextStatus: 'draft' | 'completed') {
    await persistDraft({ nextStatus, navigateAway: true });
  }

  function update<K extends keyof SessionNotePayload>(key: K, value: SessionNotePayload[K]) {
    setPayload((p) => ({ ...p, [key]: value }));
  }

  if (!ready || patient === undefined) return null;

  // Same display-level gate as NoteEditorPage — front desk has no
  // clinical-documentation need.
  if (!canViewClinicalNotes) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Session Note</h1>
        <p className="text-sm text-[var(--muted)]">Clinical notes are managed by clinical staff.</p>
        <Link
          to="/patients/$patientId"
          params={{ patientId }}
          search={backTo ? { from: backTo } : undefined}
          className="text-sm text-[var(--teal)] hover:underline"
        >
          ← Back to patient
        </Link>
      </div>
    );
  }

  const readOnly = status === 'completed';

  return (
    <div>
      <header className="app-header">
        <Link
          to="/patients/$patientId"
          params={{ patientId }}
          search={backTo ? { from: backTo } : undefined}
          className="btn-secondary"
          style={{ marginBottom: 8, display: 'inline-block', textDecoration: 'none' }}
        >
          ← {patient?.name ?? 'Patient'}
        </Link>
        <h1 className="screen-title">Session Note</h1>
      </header>

      <div className="screen-body">
        {error && (
          <div
            className="frozen-note"
            style={{ background: 'var(--rust-light)', color: 'var(--rust)' }}
          >
            {error}
            <button type="button" className="panel-close" onClick={() => setError(null)}>
              ✕
            </button>
          </div>
        )}
        {readOnly && (
          <div className="frozen-note">
            ⚠ This note is completed and read-only. Corrections need a new dated addendum note.
          </div>
        )}

        <div className="setup-section open">
          <div className="setup-section-body">
            <p className="section-label">Attending therapist</p>
            <select
              className="field-input"
              value={therapistId}
              disabled={readOnly}
              onChange={(e) => setTherapistId(e.target.value)}
            >
              {(therapists ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="setup-section open">
          <div className="setup-section-body">
            <p className="section-label">Subjective</p>
            <label className="field-label">Pain (NRS)</label>
            <ScaleWidget
              variant="nrs"
              value={payload.subjective.painNrs}
              onChange={(n) => update('subjective', { ...payload.subjective, painNrs: n })}
              endpoints={['No pain', 'Worst imaginable']}
              disabled={readOnly}
            />
            <label className="field-label" style={{ marginTop: 10, display: 'block' }}>
              Note (optional)
            </label>
            <textarea
              className="field-input"
              rows={2}
              value={payload.subjective.oneLiner}
              disabled={readOnly}
              onChange={(e) =>
                update('subjective', { ...payload.subjective, oneLiner: e.target.value })
              }
              placeholder="Short one-liner — how the patient reports feeling today"
            />
          </div>
        </div>

        <div className="setup-section open">
          <div className="setup-section-body">
            <p className="section-label">Objective</p>
            <textarea
              className="field-input"
              rows={3}
              value={payload.objective}
              disabled={readOnly}
              onChange={(e) => update('objective', e.target.value)}
              placeholder="Findings on examination this session"
            />
          </div>
        </div>

        <div className="setup-section open">
          <div className="setup-section-body">
            <p className="section-label">Intervention</p>
            <MultiToggle
              options={SESSION_INTERVENTION_OPTIONS}
              value={payload.intervention.treatments}
              onChange={(v) => update('intervention', { treatments: v })}
            />
          </div>
        </div>

        <div className="setup-section open">
          <div className="setup-section-body">
            <p className="section-label">Assessment</p>
            <SingleToggle
              options={SESSION_ASSESSMENT_OPTIONS}
              value={payload.assessment}
              onChange={(v) => update('assessment', v as SessionNotePayload['assessment'])}
            />
          </div>
        </div>

        <div className="setup-section open">
          <div className="setup-section-body">
            <p className="section-label">Plan</p>
            <SingleToggle
              options={SESSION_PLAN_OPTIONS}
              value={payload.plan}
              onChange={(v) => update('plan', v as SessionNotePayload['plan'])}
            />
          </div>
        </div>

        {!readOnly && (
          <div className="ne-actionbar">
            <span className="save-indicator">
              {saveIndicator === 'saving'
                ? 'Saving…'
                : saveIndicator === 'unsaved'
                  ? 'Unsaved changes'
                  : 'Saved'}
            </span>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => save('draft')}
            >
              Save draft
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => save('completed')}
            >
              Complete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
