import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { PatientProfileBackTarget } from '@/app/router';
import { repos } from '@/services';
import { useLiveQuery } from 'dexie-react-hooks';
import { SessionNoteEditorBody } from './SessionNoteEditorBody';

/**
 * Light per-session SOAP note editor — /patients/$patientId/notes/new-session
 * (no note yet) and, via the mode-dispatched /notes/$noteId, an existing
 * session draft/completed note. Deliberately a small single-screen form,
 * not built on NoteEditorPage's accordion/jump-nav machinery — 5 fields vs.
 * ~40+. See Billing & Notes Rebuild Phase 2 plan for C4's field list and
 * why this stays intentionally minimal: every stakeholder will want one
 * more field on it, and past one screen this rebuilds the problem it set
 * out to solve.
 *
 * A thin route wrapper — SessionNoteEditorBody owns the actual form/
 * autosave logic and is shared with the batch (Save & Next) flow in
 * SessionNoteBatchPage.tsx.
 */
export function SessionNoteEditorPage() {
  const navigate = useNavigate();
  const { patientId, noteId } = useParams({ strict: false }) as {
    patientId: string;
    noteId?: string;
  };
  const { visitId: promptedVisitId, from: backTo } = useSearch({ strict: false }) as {
    visitId?: string;
    from?: PatientProfileBackTarget;
  };
  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);

  if (patient === undefined) return null;

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

      <SessionNoteEditorBody
        patientId={patientId}
        visitId={promptedVisitId ?? null}
        noteId={noteId}
        backTo={backTo}
        onNoteIdResolved={(resolvedId) => {
          void navigate({
            to: '/patients/$patientId/notes/$noteId',
            params: { patientId, noteId: resolvedId },
            replace: true,
            search: {
              ...(promptedVisitId ? { visitId: promptedVisitId } : {}),
              ...(backTo ? { from: backTo } : {}),
            },
          });
        }}
        onSaved={() => {
          void navigate({
            to: '/patients/$patientId',
            params: { patientId },
            search: backTo ? { from: backTo } : undefined,
          });
        }}
      />
    </div>
  );
}
