import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { PatientProfileBackTarget } from '@/app/router';
import { ScaleWidget } from '@/components/ScaleWidget';
import { MultiToggle, SingleToggle } from '@/components/ui';
import { SESSION_INTERVENTION_OPTIONS } from '@/domain/treatmentOptions';
import {
  SESSION_ASSESSMENT_OPTIONS,
  SESSION_PLAN_OPTIONS,
  type SessionNotePayload,
} from '@/domain/sessionNote';
import { useSessionNoteEditor } from './useSessionNoteEditor';

/**
 * The actual SOAP form + autosave/save-bar for one session note, shared by
 * the single-visit route (SessionNoteEditorPage) and the batch flow
 * (SessionNoteBatchPage). The batch page mounts this with a `key` tied to
 * the current visit id so switching visits gets a fresh hook instance —
 * simpler and safer than trying to reset useSessionNoteEditor's internal
 * state (therapist default, payload, etc.) in place across a changing
 * visitId, and it keeps this component agnostic of whether it's mounted
 * once (single) or many times in sequence (batch).
 */
export function SessionNoteEditorBody({
  patientId,
  visitId,
  noteId,
  backTo,
  onNoteIdResolved,
  onSaved,
  primaryActionLabel = 'Complete',
  secondaryActionLabel = 'Save draft',
  extraActions,
}: {
  patientId: string;
  visitId: string | null;
  noteId?: string;
  backTo?: PatientProfileBackTarget;
  onNoteIdResolved?: (noteId: string) => void;
  onSaved: () => void;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  extraActions?: ReactNode;
}) {
  const editor = useSessionNoteEditor({ patientId, visitId, noteId, onNoteIdResolved, onSaved });
  const { ready, patient, therapists, canViewClinicalNotes, therapistId, payload } = editor;

  if (!ready || patient === undefined) return null;

  // Same display-level gate as NoteEditorPage — front desk has no
  // clinical-documentation need.
  if (!canViewClinicalNotes) {
    return (
      <div className="space-y-4">
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

  const { readOnly, busy, error, setError, saveIndicator, save, update, setTherapistId } = editor;

  return (
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
          {extraActions}
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => save('draft')}
          >
            {secondaryActionLabel}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => save('completed')}
          >
            {primaryActionLabel}
          </button>
        </div>
      )}
    </div>
  );
}
