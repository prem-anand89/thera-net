import { Link } from '@tanstack/react-router';
import type { PatientProfileBackTarget } from '@/app/router';
import type { VisitCardData } from './types';

export const NOTE_STATUS_CELL: Record<
  'draft' | 'completed' | 'archived',
  { tone: 'green' | 'amber' | 'slate'; label: string; action: string }
> = {
  draft: { tone: 'amber', label: 'Draft', action: 'Edit' },
  completed: { tone: 'green', label: 'Completed', action: 'View' },
  archived: { tone: 'slate', label: 'Archived', action: 'View' },
};

// Plain flush-left text, not `Pill` — this status sits stacked above a
// plain-text action link (and, in the table's Actions column, a plain-text
// feedback link below that). `Pill`'s own px-2 padding shifted "Draft"'s
// text a few pixels right of everything flush-left beneath it, reading as
// misaligned once there were 2-3 stacked lines instead of 1.
export const NOTE_STATUS_TEXT_COLOR: Record<'green' | 'amber' | 'slate', string> = {
  green: 'text-[var(--moss)]',
  amber: 'text-[var(--amber)]',
  slate: 'text-[var(--muted)]',
};

/** Clinical-note entry point for a visit row — shared by the table Note
 *  column and mobile cards so draft/continue/view routing stays consistent.
 *  `backTo` carries the same "which list did this come from" context as
 *  PatientNameBlock's, one hop further: the note editor's own "← {patient}"
 *  link forwards it back to the patient profile, whose "← Back" link then
 *  has somewhere real to return to instead of falling back to the bare
 *  patient list. */
export function VisitNoteLink({
  data,
  inline,
  backTo,
}: {
  data: VisitCardData;
  inline?: boolean;
  backTo?: PatientProfileBackTarget;
}) {
  if (!data.canViewNotes) return null;
  if (data.consultationNoteId && data.noteStatus) {
    const { tone, label, action } = NOTE_STATUS_CELL[data.noteStatus];
    if (inline) {
      return (
        <Link
          to="/patients/$patientId/notes/$noteId"
          params={{ patientId: data.patientId, noteId: data.consultationNoteId }}
          search={backTo ? { from: backTo } : undefined}
          className="text-xs font-medium text-[var(--teal)] hover:underline"
        >
          {action} note
        </Link>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-1">
        <span className={`whitespace-nowrap text-xs font-medium ${NOTE_STATUS_TEXT_COLOR[tone]}`}>
          {label}
        </span>
        <span className="text-xs text-[var(--muted)]">·</span>
        <Link
          to="/patients/$patientId/notes/$noteId"
          params={{ patientId: data.patientId, noteId: data.consultationNoteId }}
          search={backTo ? { from: backTo } : undefined}
          className="whitespace-nowrap text-xs font-medium text-[var(--teal)] hover:underline"
        >
          {action}
        </Link>
      </div>
    );
  }
  if (!data.needsNote) return null;
  return (
    <Link
      to="/patients/$patientId/notes/new-session"
      params={{ patientId: data.patientId }}
      search={{ visitId: data.visitId, from: backTo }}
      className="whitespace-nowrap text-xs font-medium text-[var(--amber)] hover:underline"
      title="Clinical note not started for this visit"
    >
      + Note
    </Link>
  );
}

/** Minimum time since a feedback link was last sent (create or resend)
 *  before Resend becomes available again — a patient who hasn't responded
 *  yet shouldn't get a second message within the same day or two just
 *  because staff happened to click twice. No admin override; this is a
 *  hard floor, not a suggestion. */
export const RESEND_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

/** "Ask for feedback" / "Resend" entry point for a visit row — mirrors
 *  `VisitNoteLink`'s gate-then-branch shape (hidden entirely when the
 *  viewer can't act on this row), but unlike Note this isn't a route link:
 *  it needs an `onClick` callback threaded down, same shape as `onInvoice`.
 *  Kept inline next to Note per this file's own convention (see
 *  `RowActionsMenu`'s doc comment) rather than buried in the kebab menu. */
export function VisitFeedbackLink({
  data,
  onAskForFeedback,
  onResendFeedback,
  onAskForGoogleReview,
}: {
  data: VisitCardData;
  onAskForFeedback?: () => void;
  onResendFeedback?: () => void;
  onAskForGoogleReview?: () => void;
}) {
  if (!data.canAskForFeedback) return null;
  const request = data.feedbackRequest;

  // A patient's actual rating/comment stays admin-only at the RLS layer
  // (`feedback_responses` SELECT is `is_clinic_admin()`-only) — but the
  // *eligibility* signal below is role-blind by design (see
  // `googleReviewEligible`'s own doc comment), so every role that can act
  // on a visit gets the same "it happened" marker here.
  if (request?.status === 'responded') {
    const eligibleForGoogleReview =
      !!request.googleReviewEligible && !!data.googleReviewUrl && !!onAskForGoogleReview;
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span
          className="whitespace-nowrap text-xs text-[var(--moss)]"
          title="Patient responded to the feedback request"
        >
          ★ Responded
        </span>
        {eligibleForGoogleReview && (
          <button
            type="button"
            className="whitespace-nowrap text-xs font-medium text-[var(--teal)] hover:underline"
            onClick={onAskForGoogleReview}
            title="Ask this patient to leave a Google review"
          >
            ⭐ Google review
          </button>
        )}
      </div>
    );
  }

  if (!request || request.status === 'expired') {
    if (!onAskForFeedback) return null;
    return (
      <button
        type="button"
        className="whitespace-nowrap text-xs font-medium text-[var(--teal)] hover:underline"
        onClick={onAskForFeedback}
        title="Ask this patient for feedback"
      >
        + Feedback
      </button>
    );
  }

  // Defensive only — both askForFeedback and resend write a full row
  // (token included) via their RPC's response, so this shouldn't be
  // reachable in practice; kept as a fallback for a row pulled down from
  // some other, unanticipated path. Icon + word, not icon-only: this
  // column also carries Note's actions, so a bare glyph here has no "this
  // is about feedback" context the way 🔒/✎ do sitting right next to the
  // billing/patient fields they describe.
  if (!request.token) {
    return (
      <span
        className="whitespace-nowrap text-xs text-[var(--muted)]"
        title="Preparing the feedback link"
      >
        ⏳ Feedback
      </span>
    );
  }

  // Cooldown since the link was last sent (create and resend both stamp
  // updatedAt to that moment) — resend exists for a patient who's gone
  // quiet, not as a repeatable nudge, so it stays hidden for a few days
  // rather than being one click away from back-to-back messages.
  if (Date.now() - new Date(request.updatedAt).getTime() < RESEND_COOLDOWN_MS) {
    return (
      <span className="whitespace-nowrap text-xs text-[var(--moss)]" title="Feedback request sent">
        ✓ Feedback
      </span>
    );
  }

  if (!onResendFeedback) return null;
  return (
    <button
      type="button"
      className="whitespace-nowrap text-xs font-medium text-[var(--teal)] hover:underline"
      onClick={onResendFeedback}
      title="Resend the feedback link"
    >
      ↻ Resend
    </button>
  );
}

export function NoteCell({
  data,
  backTo,
  onAskForFeedback,
  onResendFeedback,
  onAskForGoogleReview,
}: {
  data: VisitCardData;
  backTo?: PatientProfileBackTarget;
  onAskForFeedback?: () => void;
  onResendFeedback?: () => void;
  onAskForGoogleReview?: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <VisitNoteLink data={data} backTo={backTo} />
      <VisitFeedbackLink
        data={data}
        onAskForFeedback={onAskForFeedback}
        onResendFeedback={onResendFeedback}
        onAskForGoogleReview={onAskForGoogleReview}
      />
    </div>
  );
}
