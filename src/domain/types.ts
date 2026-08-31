import type { Paise } from './money';
import type { TdsBasis } from './split';

export type UUID = string;

export interface Clinic {
  id: UUID;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstNo: string | null;
  logoPath: string | null;
  partnerHospitalName: string | null;
  partnerHospitalLogoPath: string | null;
  invoicePrefix: string;
  bmSplitPct: number;
  taxPct: number;
  tdsBasis: TdsBasis;
  fyStartMonth: number;
  /** Abbreviation for the clinic's own share (default "BM"). Optional so existing rows are unaffected. */
  ownShareLabel?: string | null;
  /** Abbreviation for the partner hospital's share (default "HV"). */
  partnerShareLabel?: string | null;
  /**
   * 'individual' = single therapist clinic;
   * 'multiple' = clinic with multiple therapists.
   * Optional so older cached rows default to 'multiple' (original behavior).
   */
  clinicType?: 'individual' | 'multiple';
  /** Whether the clinic has an external partner (hospital, organization, etc.). Defaults to false. */
  hasPartner?: boolean;
  /**
   * Legacy field: maps to clinicType and hasPartner for backward compat.
   * 'hospital_split' = clinicType='multiple' + hasPartner=true (with revenue split).
   * 'simple' = clinicType='individual' + hasPartner=false.
   * Kept for older cached rows; new saves use clinicType + hasPartner.
   */
  billingMode?: 'simple' | 'hospital_split';
  /** Whether the internal therapist revenue-split feature is available. */
  enableTherapistSplit?: boolean;
  /**
   * Legacy: clinic-wide Visits-table column show/hide. Superseded by
   * per-user prefs (useVisitColumnPrefs, stored in Dexie) — this was never
   * actually read by any table, since none existed yet when it was added.
   * Kept on the type for older cached/server rows; no UI reads or writes it.
   */
  visitColumnPrefs?: Partial<Record<VisitColumnKey, boolean>> | null;
  /**
   * Client-side "this clinic uses clinical documentation" feature flag.
   * Purely a display/visibility switch — it is NOT what permits a note to
   * be written. That's a separate, always-on server-side gate:
   * `can_use_module(clinic_id, 'consultation_notes')` on
   * `consultation_notes`' insert/update RLS policies, seeded enabled for
   * every clinic with no UI to turn it off (see FEATURES_AND_SCHEMA.md).
   * The two never conflict — they act at different layers.
   *
   * Four surfaces read this flag:
   *  - `visitService.ts` — auto-flags a new visit `clinicalStatus:'pending'`
   *  - `NewVisitPage.tsx` — the "Add clinical note" CTA after saving a visit
   *  - `LedgerPage.tsx` — the "Not documented" filter checkbox
   *  - `ReportsOverviewPage.tsx` — the modality-usage chart
   *
   * One surface deliberately does NOT: Patient Profile's
   * `ConsultationNotePanel` is gated on role (`canViewClinicalNotes`) only,
   * so "New note" there stays available even with this off. Confirmed
   * intentional (not an oversight) — every therapist always has notes
   * access, full stop; this flag is an opt-in reminder/reporting layer on
   * top of that baseline, not an access gate. See FEATURES_AND_SCHEMA.md
   * for the full rule before adding a new notes entry point.
   */
  clinicalDocsEnabled?: boolean;
  /** Whether this clinic uses the invoice module at all. Optional so older cached rows default to true (original behavior). */
  billingEnabled?: boolean;
  /**
   * Who may issue invoices when billing is on. 'everyone' = any clinical
   * member (original behavior). 'billing_staff' = admin + front_desk only.
   * Optional so older cached rows default to 'everyone'.
   */
  invoicingAccess?: 'everyone' | 'billing_staff';
  /**
   * Therapist comparison chart on Reports: visible to admin + therapist
   * (not front_desk) when on, for competitive visibility. Off by default
   * — an admin opts in explicitly. Optional so older cached rows default
   * to false (original admin-only behavior).
   */
  showTherapistComparison?: boolean;
  /**
   * Prefix for auto-generated walk-in MRNOs (format `{prefix}-YYMMDD-XXX`).
   * Optional so older cached rows default to 'W' (original behavior).
   */
  walkInMrnoPrefix?: string | null;
  /**
   * Clinic UPI ID (VPA) used to generate a per-visit QR. Optional so older
   * cached rows stay valid; unset means no dynamic QR.
   */
  upiVpa?: string | null;
  /** Name shown in the patient's UPI app. Falls back to clinic name when blank. */
  upiPayeeName?: string | null;
  /** Path into `clinic-assets` for a static QR image (bank/app screenshot). */
  upiQrPath?: string | null;
  /** Off by default — Show UPI QR only appears at collection when this is on. */
  upiQrEnabled?: boolean;
  /**
   * Path into `clinic-assets` (same pattern as logoPath) for a one-time
   * uploaded signature image, printed on invoices in place of the blank
   * "Authorised signature" line. Not a cryptographic e-signature.
   */
  signaturePath?: string | null;
  /**
   * Patient communications module (booking requests, feedback capture,
   * Google review nudges, re-engagement reminders). Off by default — see
   * docs/HANDOFF-patient-comms.md. Optional so older cached rows default
   * to false (module doesn't exist for them yet).
   */
  enablePatientComms?: boolean;
  /** Where "Leave a Google review" / "Ask for a Google review" point to —
   *  unset means neither ever shows, even for a 4-5* response (Slice 3 of
   *  the same doc). Plain URL, not validated beyond what the Settings
   *  input itself enforces. */
  googleReviewUrl?: string | null;
  /** Public `/book/$bookingSlug` URL segment (Patient Communications,
   *  Slice 5) — unique, nullable; unset means the public booking form was
   *  never advertised for this clinic. Lowercase alphanumeric + hyphens,
   *  validated client-side in Settings; the DB only enforces uniqueness. */
  bookingSlug?: string | null;
  updatedAt: string;
}

/** Optional (toggleable) Visits-table columns — the essentials (patient, bill, status) aren't listed. */
export type VisitColumnKey = 'condition' | 'treatments' | 'therapist' | 'service';

export const VISIT_COLUMN_LABELS: Record<VisitColumnKey, string> = {
  service: 'Service',
  therapist: 'Therapist',
  condition: 'Condition',
  // One combined column: catalog picks from treatment_catalog plus any
  // free-text add-on for something not in the list — a single cell, not
  // two separate "Treatment" (notes) and "Treatments" (catalog) columns.
  treatments: 'Treatments',
};

/** Column order for visit tables and card detail rows — who → context → notes → service. */
export const VISIT_OPTIONAL_COLUMN_ORDER: VisitColumnKey[] = [
  'therapist',
  'condition',
  'treatments',
  'service',
];

export const DEFAULT_VISIT_COLUMN_PREFS: Record<VisitColumnKey, boolean> = {
  condition: true,
  treatments: true,
  therapist: true,
  service: true,
};

/** Resolve a clinic's share-label abbreviations, defaulting to clinic-neutral labels. */
export function clinicShareLabels(clinic: Pick<Clinic, 'ownShareLabel' | 'partnerShareLabel'>): {
  own: string;
  partner: string;
} {
  return {
    own: clinic.ownShareLabel?.trim() || 'Clinic',
    partner: clinic.partnerShareLabel?.trim() || 'Partner',
  };
}

/**
 * Which billing surfaces a clinic shows. Defaults preserve the original
 * hospital-split behavior when the fields are unset (older cached rows), so
 * nothing changes for existing clinics using billingMode.
 */
export function clinicBillingConfig(
  clinic: Pick<Clinic, 'clinicType' | 'hasPartner' | 'billingMode' | 'enableTherapistSplit'>
): { hospitalSplit: boolean; therapistSplit: boolean } {
  // Prefer new clinicType/hasPartner model; fall back to billingMode for backward compat
  let hospitalSplit: boolean;
  if (clinic.clinicType !== undefined) {
    // New model: hospitalSplit = multiple therapists AND has a partner
    hospitalSplit = clinic.clinicType === 'multiple' && (clinic.hasPartner ?? false);
  } else {
    // Legacy: billingMode
    hospitalSplit = (clinic.billingMode ?? 'hospital_split') === 'hospital_split';
  }
  return {
    hospitalSplit,
    therapistSplit: clinic.enableTherapistSplit ?? true,
  };
}

export interface Therapist {
  id: UUID;
  clinicId: UUID;
  name: string;
  active: boolean;
  /** Linked Supabase auth user, if this therapist also logs in themselves. */
  userId?: UUID | null;
  /** Path into the `clinic-assets` bucket (same pattern as Clinic.logoPath),
   *  not the image itself. Optional: most existing rows predate this field. */
  photoPath?: string | null;
  /** Registration/license number with the state physiotherapy council or
   *  equivalent body. Printed on invoices — the field TPAs check to confirm
   *  the treating therapist is a registered practitioner. */
  registrationNo?: string | null;
  updatedAt: string;
}

export interface CatalogItem {
  id: UUID;
  clinicId: UUID;
  category: string;
  name: string;
  sessionCount: number;
  basePricePaise: Paise;
  active: boolean;
  updatedAt: string;
}

/** Derived on display, never stored (spec §6.2). */
export function effectivePricePerSession(
  item: Pick<CatalogItem, 'basePricePaise' | 'sessionCount'>
): Paise {
  return Math.round(item.basePricePaise / item.sessionCount);
}

/**
 * A clinic's own list of "why this patient hasn't come back" reasons —
 * same editable-list shape as CatalogItem (add/deactivate, never delete so
 * a patient already tagged with one keeps resolving) but without the
 * pricing fields, since a reason has no session count or price.
 *
 * isClosed marks whether this reason means "no longer an active lead"
 * (e.g. Resolved, Relocated) vs. one worth still following up on (e.g.
 * Plans to return, Lost contact) — a per-item flag rather than hardcoding
 * specific reason names, since the list itself is clinic-editable and a
 * name match would silently break the moment a clinic renames or removes
 * the item the code was checking for.
 */
export interface NoReturnReasonItem {
  id: UUID;
  clinicId: UUID;
  name: string;
  isClosed: boolean;
  active: boolean;
  updatedAt: string;
}

export type MrnoSource = 'hospital' | 'auto';

/**
 * Clinic-editable referral-source list — same shape as
 * NoReturnReasonItem/CatalogItem (add / deactivate-not-delete / rename from
 * Settings). Seeded with the 6 legacy ReferringSource labels below as
 * defaults for every clinic, so nothing changes on day one; clinics can
 * rename, deactivate, or add their own from there. detailLabel drives the
 * optional free-text "who/where" field next to the picker — null means this
 * source needs no detail (e.g. "Walk-in"); a per-item flag rather than
 * hardcoding specific source names, for the same reason NoReturnReasonItem's
 * isClosed is per-item rather than name-matched.
 */
export interface ReferringSourceItem {
  id: UUID;
  clinicId: UUID;
  name: string;
  detailLabel: string | null;
  active: boolean;
  updatedAt: string;
}

/**
 * Clinic-editable list of treatment types (Exercise, Manual Therapy, Kinesio
 * Taping, ...) — same shape as NoReturnReasonItem/CatalogItem (add /
 * deactivate-not-delete / rename from Settings). Independent of the
 * billing-side service_catalog: one visit can be billed under one service
 * package while performing several treatment types, tracked via
 * Visit.treatmentIds. Also independent of Core Assessment/clinical docs, so
 * it works for every clinic regardless of clinicalDocsEnabled.
 */
export interface TreatmentItem {
  id: UUID;
  clinicId: UUID;
  name: string;
  active: boolean;
  updatedAt: string;
}

export type ReferringSource =
  'hospital_referral' | 'doctor_referral' | 'walk_in' | 'word_of_mouth' | 'online' | 'other';

export const REFERRING_SOURCE_LABELS: Record<ReferringSource, string> = {
  hospital_referral: 'Hospital referral',
  doctor_referral: 'Doctor referral',
  walk_in: 'Walk-in',
  word_of_mouth: 'Word of mouth',
  online: 'Online',
  other: 'Other',
};

/** Values an older Edit Patient form stored locally — they fail the
 *  patients_referring_source_check constraint on sync. */
const LEGACY_REFERRING_SOURCE: Record<string, ReferringSource> = {
  hospital: 'hospital_referral',
  doctor: 'doctor_referral',
  physiotherapist: 'other',
  patient_referred: 'word_of_mouth',
  self: 'walk_in',
};

export function coerceReferringSource(value: string | null | undefined): ReferringSource | null {
  if (!value) return null;
  if (value in REFERRING_SOURCE_LABELS) return value as ReferringSource;
  return LEGACY_REFERRING_SOURCE[value] ?? null;
}

/** Label for the free-text detail field, or null if that source needs no detail. */
export function referringSourceDetailLabel(
  source: ReferringSource | '' | null | undefined
): string | null {
  switch (source) {
    case 'hospital_referral':
    case 'doctor_referral':
      return 'Referring doctor';
    case 'word_of_mouth':
      return 'Referred by (patient name)';
    case 'online':
      return 'Online channel (e.g. Google, Instagram)';
    case 'other':
      return 'Details';
    default:
      return null;
  }
}

export interface Patient {
  id: UUID;
  clinicId: UUID;
  mrno: string;
  mrnoSource: MrnoSource;
  name: string;
  age: number | null;
  sex: 'M' | 'F' | 'Other' | null;
  phone: string | null;
  primaryCondition: string | null;
  /** How the patient found the clinic, from the clinic's own editable
   *  ReferringSourceItem list — the current source of truth going forward.
   *  Optional: older cached rows and patients created before this catalog
   *  existed lack the key; those fall back to the legacy referringSource
   *  enum below for display. */
  referringSourceId?: UUID | null;
  /** Legacy fixed-enum value — no longer written by new patient saves, kept
   *  only so patients created before the catalog existed still display a
   *  referral source. Optional: older cached rows lack the key. */
  referringSource?: ReferringSource | null;
  /** Free text alongside referringSourceId/referringSource — which doctor,
   *  who referred them, which online channel. */
  referringSourceDetail?: string | null;
  /** Why a single-visit patient hasn't come back — set from the Trends
   *  dashboard once known. References NoReturnReasonItem, the clinic's own
   *  editable list. Optional: older cached rows lack the key. */
  noReturnReasonId?: UUID | null;
  /** Set = hidden from search/pickers; visits keep resolving. Optional: older cached rows lack the key. */
  deletedAt?: string | null;
  /** Patient comms opt-out — honored on every send path (feedback links,
   *  booking confirmations, reminders). Optional: older cached rows lack the
   *  key and default to false (messaging allowed). */
  doNotMessage?: boolean;
  updatedAt: string;
}

export interface Visit {
  id: UUID;
  clinicId: UUID;
  patientId: UUID;
  therapistId: UUID;
  /** ISO date yyyy-mm-dd; day-of-week is derived, never stored */
  visitDate: string;
  condition: string | null;
  treatmentNotes: string | null;
  /** Which TreatmentItem catalog entries were performed this visit. Optional: older cached rows predate treatment tracking. */
  treatmentIds?: UUID[];
  serviceCatalogId: UUID;
  /** Catalog price snapshot at time of billing — discounts never touch the catalog */
  catalogPricePaise: Paise;
  actualBillPaise: Paise;
  /** actual − catalog; negative = discount, positive = top-up */
  adjustmentPaise: Paise;
  adjustmentReason: string | null;
  sessionIndex: number | null;
  packageTotal: number | null;
  /** Groups the sessions of one package; therapist may change mid-package */
  packageGroupId: UUID | null;
  /**
   * Optional internal split: a share of this visit's billed amount is
   * credited to an assisting therapist in reporting only. Never changes the
   * billed amount or the primary therapist (the hospital reconciles those).
   * Optional so existing Visit rows/construction sites are unaffected.
   */
  sharedTherapistId?: UUID | null;
  sharedPct?: number | null;
  /** Rate snapshots — historical reports stay correct if clinic rates change */
  bmSplitPct: number;
  taxPct: number;
  tdsBasis: TdsBasis;
  bmSharePaise: Paise;
  postTaxPaise: Paise;
  tdsPaise: Paise;
  hvPaise: Paise;
  invoiceId: UUID | null;
  /**
   * Set when the bill was explicitly marked "collect later" at logging time
   * (as opposed to simply having no Payment row yet). Optional free-text
   * reason ("insurance claim in process"); absence of a Payment row is what
   * actually drives outstanding calculations — this is just context for the
   * pending-work list. Optional so existing Visit rows are unaffected.
   */
  pendingPaymentNote?: string | null;
  deleted: boolean;
  /**
   * Clinical documentation fields — retrospective record of what happened,
   * kept deliberately outside protect_invoiced_visit()'s frozen-field list.
   * A therapist can finish documentation after the visit is billed.
   * Optional: older cached rows predate the clinical docs module.
   */
  patientConsentConfirmed?: boolean;
  patientSignatureUrl?: string | null;
  clinicalStatus?: 'pending' | 'documented' | 'reviewed';
  consultationNoteId?: UUID | null;
  reauthorizationRequired?: boolean;
  /**
   * Where the visit happened. Domiciliary (homecare) billing generally
   * needs this recorded explicitly and separately justified — a TPA wants
   * to see why the visit couldn't have been an in-clinic OP visit instead.
   * Optional: older cached rows predate this and default to 'clinic'.
   */
  location?: 'clinic' | 'home';
  updatedAt: string;
  /** Auth user who created/last touched this row. Optional: older cached rows lack the key. */
  createdBy?: UUID | null;
  updatedBy?: UUID | null;
}

export type PaymentMode = 'Cash' | 'Card' | 'UPI' | 'Insurance';

export interface InvoicePatientSnapshot {
  mrno: string;
  name: string;
  age: number | null;
  sex: string | null;
}

/**
 * `sessionCount`'s meaning is unchanged from before v2 —
 * `authorizedSessionCount ?? billedSessionCount` — because it's still read
 * raw with no fraction handling by legacy invoices and by
 * `InsurerPacketPage.tsx`'s older reads. All v2 fields are optional, so an
 * old jsonb-snapshotted invoice (immutable, never migrated/backfilled)
 * still satisfies this type with zero data changes — presence of
 * `lineItemVersion: 2` is what marks the new shape; see `invoiceLine.ts`'s
 * `isV2Line`/`lineRatePerSessionPaise`/`sessionCountLabel`/`lineReconciles`
 * for how build- and print-side code reads either shape without drifting.
 */
export interface InvoiceLineItem {
  serviceName: string;
  sessionCount: number;
  /** Every session date in the package, including ₹0 continuations */
  sessionDates: string[];
  /** v2: SUM of every visit's own snapshot in the merged group (not one
   *  visit's) — see `invoiceLine.ts`'s `buildLineItems` for why. */
  catalogPricePaise: Paise;
  adjustmentPaise: Paise;
  /** v2: joined from `adjustmentReasons` when a merged group spans more
   *  than one original adjustment reason. */
  adjustmentReason: string | null;
  totalPaise: Paise;
  /** Presence (not truthiness) of this field is the v2 marker. */
  lineItemVersion?: 2;
  billedSessionCount?: number;
  /** null = not a package (`normalizeAuthorizedCount` in `invoiceLine.ts`
   *  is the only correct way to derive this from a raw `packageTotal`,
   *  since `packageTotal: 0` is storable and is not "no package"). */
  authorizedSessionCount?: number | null;
  /** Snapshotted at issue time — never re-derived from live catalog
   *  prices on read. */
  ratePerSessionPaise?: Paise;
  rateBasis?: 'package_upfront' | 'per_session';
  adjustmentReasons?: string[];
  therapistIds?: UUID[];
}

/**
 * Pre-fills onto the bill from the patient's most recent completed note at
 * issue time, editable by the biller before issuing — not re-read from the
 * note afterward (H3: invoices are immutable snapshots). `sourceNoteId` is
 * provenance only, not a live reference.
 */
export interface InvoiceClinicalSnapshot {
  diagnosis: string | null;
  diagnosisIcdCode?: string | null;
  referringPhysician: string | null;
  physicianRegistrationNo: string | null;
  placeOfService: 'clinic' | 'home' | null;
  treatmentPerformed: string | null;
  sourceNoteId?: UUID | null;
  /** True when the biller changed a value away from its pre-filled
   *  default before issuing — lets the print/audit trail distinguish
   *  "matches the note" from "corrected at billing time". */
  editedByBiller?: boolean;
}

export interface Invoice {
  id: UUID;
  clinicId: UUID;
  invoiceNo: string;
  fyLabel: string;
  seq: number;
  issuedAt: string;
  patientSnapshot: InvoicePatientSnapshot;
  lineItems: InvoiceLineItem[];
  totalPaise: Paise;
  paymentMode: PaymentMode;
  therapistId: UUID | null;
  /** Set when this invoice is a correction that replaces an earlier one
   *  (e.g. a TPA asked for added visit dates) — points at the original.
   *  One-directional: the original invoice is never updated to point
   *  forward, since issued invoices are immutable. */
  supersedesInvoiceId: UUID | null;
  /** Optional — old invoices predate this field. Present only when set at
   *  issue/amend time via `IssueInvoiceDialog`'s clinical pre-fill. */
  clinicalSnapshot?: InvoiceClinicalSnapshot | null;
  updatedAt: string;
}

export type PaymentStatus = 'paid' | 'outstanding';

/**
 * Lives apart from Invoice — invoices are immutable once issued, so payment
 * status can't be a column there. Absence of a row for an invoice means
 * "paid" (every invoice issued before this feature shipped implied
 * immediate payment; see paymentService).
 */
export interface InvoicePayment {
  id: UUID;
  clinicId: UUID;
  invoiceId: UUID;
  status: PaymentStatus;
  paidAt: string | null;
  updatedAt: string;
}

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'bank_transfer' | 'cheque';

/**
 * A payment received toward one visit's bill — cash/UPI/etc, always keyed
 * by `visitId`, whether or not that visit is invoiced. There's no
 * `invoiceId` column here: an invoice has no amount-paid field of its own
 * (invoice_payments is a paid/outstanding flag only, since invoices are
 * immutable), so a payment toward an invoiced visit's bill is still logged
 * here exactly like a direct (uninvoiced) one — see
 * paymentService.recordInvoicePayment, which allocates one entered amount
 * across a multi-visit invoice's constituent Payment rows when needed.
 */
export interface Payment {
  id: UUID;
  clinicId: UUID;
  visitId: UUID;
  amountPaise: Paise;
  method: PaymentMethod;
  /** ISO date YYYY-MM-DD when payment was received */
  receivedDate: string;
  notes: string | null;
  /** Set when this payment was drawn down from a patient's advance balance
   *  (Billing & Notes Rebuild Phase 1, 1.6) rather than collected fresh —
   *  see `advanceService.applyAdvance`. Optional: pre-existing payments and
   *  every non-advance payment lack it. */
  advanceId?: UUID | null;
  updatedAt: string;
}

export type PatientAdvanceStatus = 'open' | 'exhausted' | 'refunded' | 'void';

/**
 * Money received ahead of treatment, not yet tied to any visit — draws
 * down via `Payment.advanceId`-linked rows rather than a separate
 * allocation table (see `advanceService.ts`). `method` uses the
 * `PaymentMethod` vocabulary (`'cash'|'upi'|…`), not the older
 * `PaymentMode` used by `Invoice.paymentMode` — easy to confuse.
 */
export interface PatientAdvance {
  id: UUID;
  clinicId: UUID;
  patientId: UUID;
  amountPaise: Paise;
  method: PaymentMethod;
  receivedDate: string;
  receiptNo: string | null;
  notes: string | null;
  status: PatientAdvanceStatus;
  deleted: boolean;
  updatedAt: string;
}

export type FeedbackRequestStatus = 'pending' | 'responded' | 'expired';

/**
 * Staff-triggered "ask this patient for feedback" action (Patient
 * Communications, Slice 1) — one row per visit that's been asked, feeding
 * the public `/f/$token` form. `therapistId` is denormalized from the
 * visit (not just reachable via a join) so client-side display gating can
 * mirror the `feedback_requests_insert`/`_update` RLS policy
 * (admin/front_desk/own-therapist) without an extra query, the same
 * reasoning the RLS policy itself is built on server-side.
 *
 * `token` is deliberately optional and never set by the client — the
 * Postgres column default (`generate_url_safe_token()`) only fires when a
 * column is omitted from an INSERT, and creating this row goes through
 * the normal Dexie/outbox path (same as any other clinic CRUD), not an
 * RPC. Leaving `token` unset here means the outbox's upsert payload omits
 * it, the server fills it in, and the real value round-trips back on the
 * next pull — so a freshly-created row reads `token: undefined` in the UI
 * for a moment, not a placeholder. Resending (rotating the token on an
 * existing row) can't go through this same path — column defaults don't
 * fire on UPDATE — so that's a small dedicated online-only RPC instead
 * (`rotate_feedback_request_token`), same reasoning `issue_invoice()` is
 * an RPC rather than outbox-synced.
 */
export interface FeedbackRequest {
  id: UUID;
  clinicId: UUID;
  visitId: UUID;
  patientId: UUID;
  therapistId: UUID;
  token?: string;
  status: FeedbackRequestStatus;
  expiresAt: string;
  updatedAt: string;
  createdBy?: UUID | null;
  updatedBy?: UUID | null;
}

/**
 * A patient's submission against one `FeedbackRequest` (Patient
 * Communications, Slice 2) — written only by `submit_feedback_response()`,
 * a SECURITY DEFINER RPC with no client INSERT policy; the client never
 * creates or edits these, only reads them (admin-only, per
 * `feedback_responses`' own RLS). `updatedAt` is a permanent alias for
 * `createdAt` — the row is immutable, but the sync engine hardcodes
 * `updated_at` as the delta column for every synced table, so the column
 * exists purely for that, not because responses are ever modified.
 */
export interface FeedbackResponse {
  id: UUID;
  requestId: UUID;
  clinicId: UUID;
  rating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AppointmentRequestStatus = 'pending' | 'confirmed' | 'declined';

/**
 * A patient's raw public booking submission (Patient Communications,
 * Slice 5) — written only by `submit_appointment_request()`, an anonymous
 * SECURITY DEFINER RPC; no client INSERT policy exists. `name`/`phone` are
 * the patient's own typed values, not resolved against any existing
 * `patients` row — identity resolution only ever happens later, at
 * arrival (see `Appointment`'s own doc comment), never here. Read-only
 * sync, same shape as `FeedbackResponse` — nothing client-side writes
 * this table directly, every mutation (confirm/decline) goes through an
 * RPC.
 */
export interface AppointmentRequest {
  id: UUID;
  clinicId: UUID;
  name: string;
  phone: string;
  email: string | null;
  preferredTherapistId: UUID | null;
  serviceCatalogId: UUID | null;
  /** Free text — reason for visit, symptoms, anything else the patient
   *  wants front desk to know. Distinct from `preferredTimeText`, which
   *  is purely about scheduling. */
  notes: string | null;
  /** Real calendar date, informational only — not checked against any
   *  therapist's actual availability. See this file's own note on why
   *  there's no slot-checking logic anywhere in this module yet. */
  preferredDate: string | null;
  preferredTimeText: string | null;
  status: AppointmentRequestStatus;
  appointmentId: UUID | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: UUID | null;
  updatedBy?: UUID | null;
}

export type AppointmentStatus = 'confirmed' | 'rescheduled' | 'no_show' | 'cancelled' | 'arrived';

/**
 * A confirmed expected attendance (Patient Communications, Slice 5) — not
 * a billed visit, and not the same thing as one. `patientId` is null from
 * the moment staff confirm the originating `AppointmentRequest` until
 * whichever of the two "arrived" paths resolves it (New Visit's typeahead
 * from this row, or the standalone manual toggle) — `patientName`/
 * `patientPhone` carry the raw submitted values throughout, even after
 * `patientId` resolves, so the row always has something to display.
 * `visitId` is set only once arrival creates the actual `visits` row.
 * Read-only sync, same reasoning as `AppointmentRequest` — every mutation
 * (confirm/decline/reschedule/no-show/cancel/mark-arrived/link-visit) is
 * an online-only RPC, never a direct client write.
 */
export interface Appointment {
  id: UUID;
  clinicId: UUID;
  patientId: UUID | null;
  patientName: string;
  patientPhone: string;
  therapistId: UUID | null;
  scheduledAt: string;
  status: AppointmentStatus;
  requestId: UUID | null;
  visitId: UUID | null;
  rescheduleCount: number;
  previousScheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: UUID | null;
  updatedBy?: UUID | null;
}

/** What Health Valley actually paid Beyond Mechanics for one fiscal month. */
export interface Settlement {
  id: UUID;
  clinicId: UUID;
  year: number;
  month: number;
  amountReceivedPaise: Paise;
  receivedDate: string | null;
  notes: string | null;
  updatedAt: string;
}

export type EnrollmentStatus = 'active' | 'completed' | 'discharged';

/**
 * Episode-of-care tracking for a patient's participation in a given module.
 * Core Assessment's Initial/Follow-up note-mode split depends on this: the
 * first consultation note under an active enrollment is Initial, every
 * later one in the same enrollment is Follow-up. `moduleType` matches the
 * live `patient_module_enrollments.module_type` column name and its CHECK
 * constraint's allowed values (see docs/CORE-ASSESSMENT-PORT-PLAN.md §3) —
 * not an FK to a modules table. Only 'consultation_notes' is written by any
 * client code today; the other five values are schema-permitted but unused.
 */
export interface PatientModuleEnrollment {
  id: UUID;
  clinicId: UUID;
  patientId: UUID;
  moduleType:
    | 'gut_screening'
    | 'return_to_sport'
    | 'scoliosis_screening'
    | 'face_scale'
    | 'facial_palsy'
    | 'consultation_notes';
  status: EnrollmentStatus;
  enrolledAt: string;
  updatedAt: string;
  createdBy?: UUID | null;
  updatedBy?: UUID | null;
}

export type PlanTier = 'lite' | 'solo' | 'clinic' | 'clinic_plus';
export type PlanStatus = 'active' | 'past_due' | 'read_only';

/**
 * Mirrors the `clinic_plans` table (tier-based subscriptions plan, Phase 0):
 * one row per clinic, keyed by `clinicId` (not `id` — there is no surrogate
 * id column). Written only by `service_role`; the client never writes this,
 * so it isn't part of `CLIENT_WRITABLE_TABLES`/`ALL_SYNCED_TABLES` — see
 * `useEntitlements()` for how it's read.
 */
export interface ClinicPlan {
  clinicId: UUID;
  planTier: PlanTier;
  status: PlanStatus;
  maxMembers: number;
  /** null = unlimited */
  visitCapPerMonth: number | null;
  updatedAt: string;
}

export type ConsultationNoteStatus = 'draft' | 'completed' | 'archived';
/**
 * 'initial'/'followup' are the heavy Core Assessment editor's two episode
 * stages (see domain/coreAssessment.ts); 'session' is the light per-visit
 * SOAP note (domain/sessionNote.ts). This field does double duty — episode
 * stage AND payload shape collapse onto one column. That's lossless today
 * (each value maps to exactly one shape and one stage), but would stop
 * being lossless if a future light-note variant needed a different stage
 * semantic. Anywhere this is read off a stored row, treat `null` (legacy
 * rows predate this field) as
 * 'initial'/'followup' territory, never as 'session' — see
 * NoteEditorPage.tsx's `?? 'initial'` default.
 */
export type NoteMode = 'initial' | 'followup' | 'session';

/**
 * Structured clinical note, distinct from a visit's free-text treatment
 * notes. Carries sign-off status and an authorized session count so a
 * course of treatment can be tracked independent of billing. One note
 * documents one visit (visitId nullable only until a visit is picked).
 *
 * `assessmentPayload` carries the Core Assessment handoff v1.3 structured
 * JSON (see `domain/coreAssessment.ts`) when this note is a Core Assessment;
 * null for a plain free-text note. The four scalar fields alongside it are a
 * derived, queryable projection of that payload — written by the same save
 * that writes the payload, never authored independently — so outcome-
 * tracking trend queries are an indexed query instead of loading every note
 * and JSON.parsing each one.
 */
export interface ConsultationNote {
  id: UUID;
  clinicId: UUID;
  patientId: UUID;
  therapistId: UUID;
  visitId: UUID | null;
  enrollmentId: UUID | null;
  authorizedSessionCount: number | null;
  notesText: string | null;
  assessmentPayload: Record<string, unknown> | null;
  noteMode: NoteMode | null;
  nrsScore: number | null;
  psfsMean: number | null;
  redFlagCount: number;
  status: ConsultationNoteStatus;
  updatedAt: string;
  /** Auth user who created/last touched this row. Optional: older cached rows lack the key. */
  createdBy?: UUID | null;
  updatedBy?: UUID | null;
}
