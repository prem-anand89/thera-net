/**
 * Light per-session SOAP note payload — the "session" NoteMode's shape,
 * distinct from and independent of coreAssessment.ts's CoreAssessmentPayload
 * (the heavy editor). Maximally tappable, minimal typing, per the Billing &
 * Notes Rebuild plan's C4: Subjective / Objective / Intervention /
 * Assessment / Plan. Objective stays free text for now (decision D3) until
 * a future pinned-measures redesign.
 */

export const SESSION_PAYLOAD_VERSION = '1.0' as const;

export type SessionAssessment = 'improving' | 'unchanged' | 'regressed' | 'flare' | '';
export const SESSION_ASSESSMENT_OPTIONS: { value: SessionAssessment; label: string }[] = [
  { value: 'improving', label: 'Improving' },
  { value: 'unchanged', label: 'Unchanged' },
  { value: 'regressed', label: 'Regressed' },
  { value: 'flare', label: 'Flare' },
];

export type SessionPlan = 'continue' | 'progress' | 'modify' | 'review' | 'discharge' | '';
export const SESSION_PLAN_OPTIONS: { value: SessionPlan; label: string }[] = [
  { value: 'continue', label: 'Continue' },
  { value: 'progress', label: 'Progress' },
  { value: 'modify', label: 'Modify' },
  { value: 'review', label: 'Review' },
  { value: 'discharge', label: 'Discharge' },
];

export interface SessionNotePayload {
  version: typeof SESSION_PAYLOAD_VERSION;
  /** Self-tag, independent of the outer ConsultationNote.noteMode column —
   *  makes the payload's own shape identifiable without trusting a column
   *  elsewhere staying in sync. */
  kind: 'session';
  enrollmentId: string;
  subjective: {
    painNrs: number | null;
    oneLiner: string;
  };
  objective: string;
  intervention: {
    treatments: string[];
  };
  assessment: SessionAssessment;
  plan: SessionPlan;
}

export function emptySessionPayload(enrollmentId: string): SessionNotePayload {
  return {
    version: SESSION_PAYLOAD_VERSION,
    kind: 'session',
    enrollmentId,
    subjective: { painNrs: null, oneLiner: '' },
    objective: '',
    intervention: { treatments: [] },
    assessment: '',
    plan: '',
  };
}

/** Upcasts an older/partial stored payload to the current shape — same
 *  read-time-upcast, not backfill, convention as coreAssessment.ts's
 *  upcastPayload. Today there is only one version, so this is a
 *  pass-through merge against emptySessionPayload(). */
export function upcastSessionPayload(stored: Record<string, unknown>): SessionNotePayload {
  const enrollmentId = typeof stored.enrollmentId === 'string' ? stored.enrollmentId : '';
  return { ...emptySessionPayload(enrollmentId), ...stored, kind: 'session' } as SessionNotePayload;
}

/** A session note has no PSFS and no red-flag screening by design (C4) —
 *  only nrsScore has a light-note equivalent. Callers still write literal
 *  0/null for the other derived columns; see consultationNoteService's
 *  saveSessionNote. */
export function computeSessionDerivedFields(payload: SessionNotePayload): {
  nrsScore: number | null;
} {
  return { nrsScore: payload.subjective.painNrs };
}
