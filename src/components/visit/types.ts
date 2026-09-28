import type {
  ConsultationNoteStatus,
  FeedbackRequestStatus,
  UUID,
} from '@/domain/types';
import type { Paise } from '@/domain/money';
import type { VisitPaymentState } from '@/domain/paymentState';

/**
 * One row's worth of data for `SharedVisitCard`, normalized away from
 * whichever screen-specific shape (TodayVisitRow/RecentVisitRow/raw Visit +
 * lookup maps) the caller actually has. Each screen maps its own rows into
 * this rather than the card importing dashboardService's types directly.
 */
export interface VisitCardData {
  visitId: UUID;
  visitDate: string;
  patientId: UUID;
  patientName: string;
  /** Pre-addresses `wa.me` sends (feedback, reminders). Optional when the
   *  row builder has no phone join or comms actions are hidden. */
  patientPhone?: string | null;
  mrno: string;
  age?: number | null;
  sex?: 'M' | 'F' | 'Other' | null;
  condition: string | null;
  serviceName: string;
  sessionIndex: number | null;
  packageTotal: number | null;
  therapistName: string;
  treatmentNotes: string | null;
  /** Resolved treatment_catalog names for this visit's "Treatments performed" — pre-resolved, not raw ids. */
  treatmentNames: string[];
  billPaise: Paise;
  paymentState: VisitPaymentState;
  invoiceId: UUID | null;
  /** Sum of direct `payments` rows against this visit — required (not
   *  optional) so every builder is forced to assign it; only meaningfully
   *  read for the `partially_collected` "of" form and the Collect button's
   *  outstanding-amount calculation. */
  collectedPaise: Paise;
  /** This visit's invoice's `issuedAt`, or null if uninvoiced — required so
   *  every builder assigns it; feeds `paymentBadge()`'s D2
   *  `max(visitDate, issuedAt)` Overdue anchor. */
  issuedAt: string | null;
  /** Set when someone other than the original author last touched this row. */
  editedBy?: string | null;
  syncError?: string | null;
  canRepeat: boolean;
  canEdit?: boolean;
  canSplit?: boolean;
  hasSplit?: boolean;
  /** The assisting therapist's share, set together with `hasSplit` — the
   *  row previously only showed *whether* a split existed (via the kebab
   *  menu's "Edit split" vs "Split revenue" label), with no indication of
   *  the percentage or who it went to short of opening that dialog. */
  sharedPct?: number | null;
  sharedTherapistName?: string | null;
  canDelete: boolean;
  /** True when this visit is flagged for a clinical note that hasn't been completed yet. */
  needsNote?: boolean;
  /**
   * Whether this viewer can open the note editor for this visit's patient
   * at all (mirrors `usePermissions().canViewClinicalNotes` — false for
   * front desk). Independent of `needsNote`: `needsNote` only lights up
   * when the clinic has clinicalDocsEnabled *and* the visit predates a
   * completed note, so a clinic that has it off, or a visit whose note is
   * already done, previously had no notes entry point at all outside
   * Patient Profile.
   */
  canViewNotes?: boolean;
  /** The note (draft OR completed) attached to this visit, if any — set
   *  by joining against consultationNotes on visitId, not the visit's own
   *  stale completed-only field (see `noteStatus`). Routes the Note
   *  column's action to that note instead of starting a new one. */
  consultationNoteId?: UUID | null;
  /** Status of `consultationNoteId`'s note, so the Note column can show
   *  "Draft" (still editable) vs "Completed" (locked, view-only in
   *  NoteEditorPage — `readOnly = status === 'completed'`) rather than
   *  treating every existing note the same way. Unset/null when there's
   *  no note at all for this visit yet. */
  noteStatus?: ConsultationNoteStatus | null;
  /**
   * True for a ₹0 package-continuation visit whose OWN `invoiceId` is
   * null but a sibling session in the same package group already has
   * one — i.e. this session was logged after the package's invoice was
   * issued, so it never got swept in (`invoiceService.collectVisits`
   * only grabs whatever's in the group at issue time). Without this
   * flag, two ₹0 rows of the same package look arbitrarily different
   * (one 🔒, one not) with nothing explaining why.
   */
  packageInvoicePending?: boolean;
  /** The visit's own therapist (Patient Communications, Slice 1) — needed
   *  alongside `canAskForFeedback` because the underlying RLS policy
   *  (admin/front_desk/own-therapist) is row-scoped, not a flat
   *  Permissions boolean; mirrors the same `therapistId` every builder
   *  already has when computing `canModify`-style flags. */
  therapistId?: UUID;
  /** Whether this viewer may ask this visit's patient for feedback —
   *  `isAdmin || therapistId === myTherapistId`, further gated on
   *  `clinic.enablePatientComms`. Computed per-row by the caller, same as
   *  `canEdit`/`canSplit`, not read off a flat Permissions object. */
  canAskForFeedback?: boolean;
  /** The visit's `feedback_requests` row, if any has ever been created —
   *  `token` is optional because a just-created row hasn't synced its
   *  server-generated token back down yet (see `FeedbackRequest`'s own
   *  doc comment). `updatedAt` doubles as "last sent at" — both the
   *  create and resend paths stamp it to the moment the link went out, so
   *  it's what `VisitFeedbackLink` uses to enforce the resend cooldown,
   *  not a separate field. `null`/unset means no request exists yet. */
  feedbackRequest?: {
    id: UUID;
    status: FeedbackRequestStatus;
    token?: string;
    updatedAt: string;
    /** Set only once `status` is `'responded'` — whether this response
     *  qualifies for the "Ask for a Google review" nudge (Slice 3: 4-5*
     *  only). Deliberately a bare boolean, not the rating itself: an admin
     *  caller derives it from the synced `feedback_responses.rating` (which
     *  only ever reaches their Dexie, per RLS), while a front_desk caller
     *  has no rating available at all and instead derives it from
     *  `list_google_review_eligible_requests()` — a role-blind RPC that
     *  answers "does this qualify" without ever exposing the rating value
     *  itself (see that migration's own comment). Either way the nudge
     *  still also needs `googleReviewUrl` set below. */
    googleReviewEligible?: boolean;
  } | null;
  /** Clinic's Google review link (Slice 3) — unset means the nudge never
   *  shows, even for a 4-5* response. Plain passthrough of
   *  `clinic.googleReviewUrl`, not derived. */
  googleReviewUrl?: string | null;
}

/** Opt-in row checkboxes for bulk actions (currently: Patient Profile's
 *  "select visits, issue one invoice" flow) — shared between the card list
 *  and the table so the feature works at every breakpoint. */
export interface VisitSelectionProps {
  selectedIds: Set<UUID>;
  onToggle: (visitId: UUID) => void;
  isSelectable: (row: VisitCardData) => boolean;
}
