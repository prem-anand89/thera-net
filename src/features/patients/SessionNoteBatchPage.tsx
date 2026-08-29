import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { PatientProfileBackTarget } from '@/app/router';
import { useClinic } from '@/app/clinicContext';
import { repos, consultationNoteService } from '@/services';
import { formatDateDM } from '@/domain/fiscalYear';
import { SessionNoteEditorBody } from './SessionNoteEditorBody';

/**
 * Edit multiple session notes back-to-back, one visit at a time, without
 * returning to Patient Profile between each — Billing & Notes Rebuild
 * Phase 3. The queue of visit ids is resolved once by the caller (Patient
 * Profile's "Write session notes" button) and carried in the URL.
 *
 * Each visit gets its own mount of SessionNoteEditorBody, keyed on the
 * visit id — a fresh hook instance per visit is simpler and safer than
 * resetting useSessionNoteEditor's internal state (therapist default,
 * payload, autosave timers) in place as visitId changes underneath it.
 *
 * Nothing here is durable "batch session" state: every note that reaches
 * draft or completed is saved the moment it happens via the same
 * persistDraft path the single editor uses, so leaving mid-queue just
 * means the remaining visits are still `needsNote` and reappear next time
 * the entry point recomputes its queue — no separate progress to lose.
 */
export function SessionNoteBatchPage() {
  const navigate = useNavigate();
  const clinic = useClinic();
  const { patientId } = useParams({ strict: false }) as { patientId: string };
  const { visitIds, from: backTo } = useSearch({ strict: false }) as {
    visitIds: string[];
    from?: PatientProfileBackTarget;
  };

  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);

  const [currentIndex, setCurrentIndex] = useState(0);
  // Which visit each already-touched-in-this-session note id belongs to —
  // lets Prev reopen an earlier note (read-only if completed) instead of
  // accidentally starting a second note for the same visit, and is also
  // how the staleness check below tells "we just completed this ourselves"
  // apart from "someone else completed it while we were elsewhere".
  const [noteIdByVisit, setNoteIdByVisit] = useState<Record<string, string>>({});
  const [autoSkipped, setAutoSkipped] = useState<string[]>([]);

  const visitIdsKey = visitIds.join(',');
  const visitsList = useLiveQuery(
    () => Promise.all(visitIds.map((id) => repos.visits.get(id))),
    [visitIdsKey]
  );
  const visitById = useMemo(() => {
    const map = new Map<string, { id: string; visitDate: string }>();
    for (const v of visitsList ?? []) if (v) map.set(v.id, v);
    return map;
  }, [visitsList]);

  // Live notes, to detect a visit that got its session note completed
  // elsewhere (another tab/device) while this queue was in progress.
  const notes = useLiveQuery(
    () => consultationNoteService.listByPatient(clinic.id, patientId),
    [clinic.id, patientId]
  );
  const completedVisitIds = useMemo(() => {
    const s = new Set<string>();
    for (const n of notes ?? []) {
      if (n.noteMode === 'session' && n.status === 'completed' && n.visitId) s.add(n.visitId);
    }
    return s;
  }, [notes]);

  const currentVisitId = visitIds[currentIndex] ?? null;

  // Auto-skip a visit that's already completed and that we ourselves
  // haven't touched yet in this session (noteIdByVisit has no entry for
  // it) — i.e. someone else finished it concurrently. A visit we just
  // completed ourselves is already in noteIdByVisit by the time its
  // completion shows up here, so this never fires for our own progress.
  useEffect(() => {
    if (!currentVisitId) return;
    if (completedVisitIds.has(currentVisitId) && !(currentVisitId in noteIdByVisit)) {
      setAutoSkipped((prev) => (prev.includes(currentVisitId) ? prev : [...prev, currentVisitId]));
      setCurrentIndex((i) => i + 1);
    }
  }, [currentVisitId, completedVisitIds, noteIdByVisit]);

  // Queue exhausted (ran off the end via Skip, or the last visit was just
  // saved) — nothing left to edit, return to the patient.
  useEffect(() => {
    if (visitIds.length === 0 || currentIndex >= visitIds.length) {
      void navigate({
        to: '/patients/$patientId',
        params: { patientId },
        search: backTo ? { from: backTo } : undefined,
        replace: true,
      });
    }
  }, [currentIndex, visitIds.length, navigate, patientId, backTo]);

  if (!currentVisitId || patient === undefined) return null;

  const isLast = currentIndex === visitIds.length - 1;
  const total = visitIds.length;
  const visitDate = visitById.get(currentVisitId)?.visitDate;
  const resolvedNoteId = noteIdByVisit[currentVisitId];

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
        <h1 className="screen-title">Session Notes</h1>
        <p className="text-sm text-[var(--muted)]">
          Visit {currentIndex + 1} of {total}
          {visitDate ? ` — ${formatDateDM(visitDate)}` : ''}
        </p>
        {autoSkipped.length > 0 && (
          <p className="text-xs text-[var(--muted)]">
            Already documented elsewhere — skipped {autoSkipped.length} visit
            {autoSkipped.length === 1 ? '' : 's'}.
          </p>
        )}
      </header>

      <SessionNoteEditorBody
        key={currentVisitId}
        patientId={patientId}
        visitId={currentVisitId}
        noteId={resolvedNoteId}
        backTo={backTo}
        onNoteIdResolved={(id) => {
          setNoteIdByVisit((prev) =>
            prev[currentVisitId] === id ? prev : { ...prev, [currentVisitId]: id }
          );
        }}
        onSaved={() => setCurrentIndex((i) => i + 1)}
        primaryActionLabel={isLast ? 'Save & Finish' : 'Save & Next'}
        secondaryActionLabel={isLast ? 'Save draft & Finish' : 'Save draft & Next'}
        extraActions={
          <>
            {currentIndex > 0 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              >
                ← Prev
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCurrentIndex((i) => i + 1)}
            >
              Skip
            </button>
          </>
        }
      />
    </div>
  );
}
