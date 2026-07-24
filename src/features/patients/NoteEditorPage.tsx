import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, consultationNoteService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { getSupabase } from '@/lib/supabase';
import { Pill, Field, ErrorNote, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { formatDateDMY } from '@/domain/fiscalYear';
import type { ConsultationNote, ConsultationNoteStatus } from '@/domain/types';

const STATUS_PILL: Record<ConsultationNoteStatus, { tone: 'green' | 'amber' | 'slate'; label: string }> = {
  draft: { tone: 'amber', label: 'Draft' },
  completed: { tone: 'green', label: 'Completed' },
  archived: { tone: 'slate', label: 'Archived' },
};

/** Best-effort, online-only read of current_consents — never blocks saving a draft. */
function useTreatmentConsentStatus(clinicId: string, patientId: string) {
  const [status, setStatus] = useState<'unknown' | 'on_file' | 'not_on_file'>('unknown');
  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabase();
    if (!supabase) return;
    Promise.resolve(
      supabase
        .from('current_consents')
        .select('is_in_force')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .eq('consent_type', 'patient_treatment')
        .maybeSingle()
    )
      .then(({ data }: { data: { is_in_force: boolean } | null }) => {
        if (!cancelled) setStatus(data?.is_in_force ? 'on_file' : 'not_on_file');
      })
      .catch(() => {
        if (!cancelled) setStatus('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [clinicId, patientId]);
  return status;
}

/**
 * Full-page note editor (recommended over a modal — notes can get long).
 * Handles both /notes/new (no note yet — pick a visit, first save creates
 * the draft) and /notes/$noteId (existing draft/completed/archived note).
 * Completed/archived notes render read-only rather than forking into a
 * separate view component, so the two layouts can't drift apart.
 */
export function NoteEditorPage() {
  const clinic = useClinic();
  const navigate = useNavigate();
  const { patientId, noteId } = useParams({ strict: false }) as {
    patientId: string;
    noteId?: string;
  };
  const isNew = !noteId;

  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);
  const existingNote = useLiveQuery(
    () => (noteId ? repos.consultationNotes.get(noteId) : Promise.resolve(undefined)),
    [noteId]
  );
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id), [clinic.id]);
  const visits = useLiveQuery(
    () => repos.visits.list({ clinicId: clinic.id, patientId }),
    [clinic.id, patientId]
  );
  const allNotes = useLiveQuery(
    () => consultationNoteService.listByPatient(clinic.id, patientId),
    [clinic.id, patientId]
  );

  const consentStatus = useTreatmentConsentStatus(clinic.id, patientId);

  const [note, setNote] = useState<ConsultationNote | null>(null);
  const [therapistId, setTherapistId] = useState('');
  const [visitId, setVisitId] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');
  const [sessionCount, setSessionCount] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate local edit state once the existing note loads (or stays null for /new).
  useEffect(() => {
    if (!isNew && existingNote) {
      setNote(existingNote);
      setTherapistId(existingNote.therapistId);
      setVisitId(existingNote.visitId);
      setNotesText(existingNote.notesText ?? '');
      setSessionCount(existingNote.authorizedSessionCount ?? '');
    }
  }, [isNew, existingNote]);

  // A visit counts as "documented" once some note (other than this one)
  // points at it — that note's own visitId doesn't disqualify itself.
  const linkedElsewhere = useMemo(
    () =>
      new Set(
        (allNotes ?? [])
          .filter((n) => n.id !== note?.id)
          .map((n) => n.visitId)
          .filter((id): id is string => Boolean(id))
      ),
    [allNotes, note?.id]
  );
  const undocumentedVisits = useMemo(
    () =>
      (visits ?? [])
        .filter((v) => !v.deleted && !linkedElsewhere.has(v.id))
        .sort((a, b) => b.visitDate.localeCompare(a.visitDate)),
    [visits, linkedElsewhere]
  );
  const visitById = useMemo(() => new Map((visits ?? []).map((v) => [v.id, v])), [visits]);

  const therapistName = useMemo(
    () => new Map((therapists ?? []).map((t) => [t.id, t.name])),
    [therapists]
  );

  if (!patient) {
    return (
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-8 text-sm text-[var(--muted)]">
        Patient not found (or not yet synced).
      </div>
    );
  }

  const readOnly = note ? note.status !== 'draft' : false;

  async function ensureDraftExists(): Promise<ConsultationNote> {
    if (note) return note;
    if (!therapistId) throw new Error('Select a therapist first');
    const created = await consultationNoteService.startOrContinueDraft(
      clinic.id,
      patientId,
      therapistId,
      visitId
    );
    setNote(created);
    // Swap the URL from /notes/new to /notes/$noteId so a refresh continues
    // this same draft instead of risking a second one.
    navigate({
      to: '/patients/$patientId/notes/$noteId',
      params: { patientId, noteId: created.id },
      replace: true,
    });
    return created;
  }

  async function handleAutosave(nextText: string, nextSessionCount: number | '') {
    setNotesText(nextText);
    setSessionCount(nextSessionCount);
    if (readOnly) return;
    setSaving(true);
    setError(null);
    try {
      const current = await ensureDraftExists();
      const saved = await consultationNoteService.saveDraft(current, {
        notesText: nextText || null,
        authorizedSessionCount: nextSessionCount === '' ? null : nextSessionCount,
        visitId,
      });
      setNote(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the note');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status: ConsultationNoteStatus) {
    setError(null);
    try {
      const current = await ensureDraftExists();
      const updated = await consultationNoteService.setStatus(current, status);
      setNote(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the note');
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        to="/patients/$patientId"
        params={{ patientId }}
        className="text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]"
      >
        ← {patient.name}
      </Link>

      <ErrorNote message={error} />

      <section className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-lg font-semibold text-[var(--ink)]">
              Consultation note — {patient.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <span className="font-num">MRN {patient.mrno}</span>
              {note && (
                <span className="font-num">
                  updated {formatDateDMY(note.updatedAt.slice(0, 10))}
                </span>
              )}
              {consentStatus !== 'unknown' && (
                <Pill tone={consentStatus === 'on_file' ? 'green' : 'amber'}>
                  {consentStatus === 'on_file' ? 'Consent on file' : 'No consent on record'}
                </Pill>
              )}
            </div>
          </div>
          {note && <Pill tone={STATUS_PILL[note.status].tone}>{STATUS_PILL[note.status].label}</Pill>}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Therapist">
            <select
              className={inputCls}
              value={therapistId}
              disabled={readOnly || !isNew}
              onChange={(e) => setTherapistId(e.target.value)}
            >
              <option value="">Select therapist…</option>
              {(therapists ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Documenting visit">
            <select
              className={inputCls}
              value={visitId ?? ''}
              disabled={readOnly}
              onChange={(e) => setVisitId(e.target.value || null)}
            >
              <option value="">No visit linked</option>
              {visitId && !undocumentedVisits.some((v) => v.id === visitId) && visitById.get(visitId) && (
                <option value={visitId}>{formatDateDMY(visitById.get(visitId)!.visitDate)}</option>
              )}
              {undocumentedVisits.map((v) => (
                <option key={v.id} value={v.id}>
                  {formatDateDMY(v.visitDate)}
                  {v.condition ? ` — ${v.condition}` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Authorized session count">
            <input
              type="number"
              min={1}
              className={inputCls}
              disabled={readOnly}
              value={sessionCount}
              onChange={(e) =>
                handleAutosave(notesText, e.target.value === '' ? '' : Number(e.target.value))
              }
            />
          </Field>
        </div>
      </section>

      <NoteBody value={notesText} readOnly={readOnly} onChange={(v) => handleAutosave(v, sessionCount)} />

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--muted)]">
          {readOnly ? 'This note is locked for editing.' : saving ? 'Saving…' : 'Draft autosaves as you type.'}
        </span>
        {!readOnly && (
          <div className="flex gap-2">
            <button className={btnSecondary} onClick={() => handleStatusChange('archived')}>
              Archive
            </button>
            <button className={btnPrimary} onClick={() => handleStatusChange('completed')}>
              Mark completed
            </button>
          </div>
        )}
        {note?.status === 'completed' && (
          <button className={btnSecondary} onClick={() => handleStatusChange('archived')}>
            Archive
          </button>
        )}
      </div>

      {allNotes && allNotes.length > 1 && (
        <section className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="font-display mb-2 text-sm font-semibold text-[var(--ink)]">Note history</h2>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {allNotes
              .filter((n) => n.id !== note?.id)
              .map((n) => (
                <li key={n.id} className="flex items-center justify-between py-2">
                  <Link
                    to="/patients/$patientId/notes/$noteId"
                    params={{ patientId, noteId: n.id }}
                    className="text-[var(--ink)] hover:text-[var(--teal)]"
                  >
                    {formatDateDMY(n.updatedAt.slice(0, 10))} — {therapistName.get(n.therapistId) ?? '—'}
                  </Link>
                  <Pill tone={STATUS_PILL[n.status].tone}>{STATUS_PILL[n.status].label}</Pill>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * v1: single free-text field. Isolated as its own subcomponent so that if a
 * structured Subjective/Objective/Assessment/Plan split is adopted later,
 * only this component changes — the editor around it doesn't know or care.
 */
function NoteBody({
  value,
  readOnly,
  onChange,
}: {
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <section className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Note</label>
      <textarea
        className={`${inputCls} min-h-[16rem] resize-y`}
        disabled={readOnly}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Subjective / objective / assessment / plan — free text for v1."
      />
    </section>
  );
}
