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
   * 'hospital_split' = the clinic-share/partner-share/TDS/Post-Tax model;
   * 'simple' = a plain clinic that just bills a visit (no share/tax columns).
   * Optional so older cached rows default to hospital_split (current behavior).
   */
  billingMode?: 'simple' | 'hospital_split';
  /** Whether the internal therapist revenue-split feature is available. */
  enableTherapistSplit?: boolean;
  /**
   * Per-clinic show/hide for the optional Visits-table columns. Missing keys
   * fall back to the defaults in `visibleVisitColumns`. Optional so older
   * cached rows are unaffected.
   */
  visitColumnPrefs?: Partial<Record<VisitColumnKey, boolean>> | null;
  /** Whether the clinical documentation module (consultation notes, screening, consent) is on. */
  clinicalDocsEnabled?: boolean;
  updatedAt: string;
}

/** Optional (toggleable) Visits-table columns — the essentials aren't listed. */
export type VisitColumnKey = 'condition' | 'treatment' | 'adjustment';

export const VISIT_COLUMN_LABELS: Record<VisitColumnKey, string> = {
  condition: 'Condition',
  treatment: 'Treatment',
  adjustment: 'Adjustment (Adj.)',
};

/**
 * Which optional Visits columns a clinic shows. Adjustment is off by default
 * (most clinics don't need the catalog-vs-actual variance column); condition
 * and treatment are on. Stored prefs override these per clinic.
 */
export function visibleVisitColumns(
  clinic: Pick<Clinic, 'visitColumnPrefs'>
): Record<VisitColumnKey, boolean> {
  const prefs = clinic.visitColumnPrefs ?? {};
  return {
    condition: prefs.condition ?? true,
    treatment: prefs.treatment ?? true,
    adjustment: prefs.adjustment ?? false,
  };
}

/** Resolve a clinic's share-label abbreviations, defaulting to BM/HV. */
export function clinicShareLabels(
  clinic: Pick<Clinic, 'ownShareLabel' | 'partnerShareLabel'>
): { own: string; partner: string } {
  return {
    own: clinic.ownShareLabel?.trim() || 'BM',
    partner: clinic.partnerShareLabel?.trim() || 'HV',
  };
}

/**
 * Which billing surfaces a clinic shows. Defaults preserve the original
 * hospital-split behavior when the fields are unset (older cached rows or the
 * founding clinic), so nothing changes for Beyond Mechanics.
 */
export function clinicBillingConfig(
  clinic: Pick<Clinic, 'billingMode' | 'enableTherapistSplit'>
): { hospitalSplit: boolean; therapistSplit: boolean } {
  const hospitalSplit = (clinic.billingMode ?? 'hospital_split') === 'hospital_split';
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
export function effectivePricePerSession(item: Pick<CatalogItem, 'basePricePaise' | 'sessionCount'>): Paise {
  return Math.round(item.basePricePaise / item.sessionCount);
}

export type MrnoSource = 'hospital' | 'auto';

export type ReferringSource =
  | 'hospital_referral'
  | 'doctor_referral'
  | 'walk_in'
  | 'word_of_mouth'
  | 'online'
  | 'other';

export const REFERRING_SOURCE_LABELS: Record<ReferringSource, string> = {
  hospital_referral: 'Hospital referral',
  doctor_referral: 'Doctor referral',
  walk_in: 'Walk-in',
  word_of_mouth: 'Word of mouth',
  online: 'Online',
  other: 'Other',
};

/** Label for the free-text detail field, or null if that source needs no detail. */
export function referringSourceDetailLabel(source: ReferringSource | '' | null | undefined): string | null {
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
  /** How the patient found the clinic. Optional: older cached rows lack the key. */
  referringSource?: ReferringSource | null;
  /** Free text alongside referringSource — which doctor, who referred them, which online channel. */
  referringSourceDetail?: string | null;
  /** Set = hidden from search/pickers; visits keep resolving. Optional: older cached rows lack the key. */
  deletedAt?: string | null;
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

export interface InvoiceLineItem {
  serviceName: string;
  sessionCount: number;
  /** Every session date in the package, including ₹0 continuations */
  sessionDates: string[];
  catalogPricePaise: Paise;
  adjustmentPaise: Paise;
  adjustmentReason: string | null;
  totalPaise: Paise;
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

export type ConsultationNoteStatus = 'draft' | 'completed' | 'archived';

/**
 * Structured clinical note, distinct from a visit's free-text treatment
 * notes. Carries sign-off status and an authorized session count so a
 * course of treatment can be tracked independent of billing.
 */
export interface ConsultationNote {
  id: UUID;
  clinicId: UUID;
  patientId: UUID;
  therapistId: UUID;
  authorizedSessionCount: number | null;
  notesText: string | null;
  status: ConsultationNoteStatus;
  updatedAt: string;
}

export type ModuleType =
  | 'gut_screening'
  | 'return_to_sport'
  | 'scoliosis_screening'
  | 'face_scale'
  | 'facial_palsy';
export type ModuleEnrollmentStatus = 'active' | 'completed' | 'discharged';

/**
 * Which lightweight screening module(s) a patient is registered in.
 * Re-enrollment into the same module while an existing enrollment is still
 * active is allowed by design — no uniqueness constraint.
 */
export interface PatientModuleEnrollment {
  id: UUID;
  clinicId: UUID;
  patientId: UUID;
  moduleType: ModuleType;
  status: ModuleEnrollmentStatus;
  enrolledAt: string;
  updatedAt: string;
}

/** Flat questionnaire capture — used by Gut Screening and future simple modules. */
export interface ScreeningResponse {
  id: UUID;
  clinicId: UUID;
  patientId: UUID;
  enrollmentId: UUID | null;
  responses: Record<string, unknown>;
  computedScore: number | null;
  triageLevel: string | null;
  updatedAt: string;
}

/** Return to Sport's richer, multi-page assessment — kept separate from the flat shape. */
export interface ReturnToSportResponse {
  id: UUID;
  clinicId: UUID;
  patientId: UUID;
  enrollmentId: UUID | null;
  responses: Record<string, unknown>;
  computedScore: number | null;
  riskCategory: string | null;
  updatedAt: string;
}

/** Scoliosis Screening's richer, multi-page assessment — kept separate from the flat shape. */
export interface ScoliosisScreeningResponse {
  id: UUID;
  clinicId: UUID;
  patientId: UUID;
  enrollmentId: UUID | null;
  responses: Record<string, unknown>;
  cobbAngle: number | null;
  severityLevel: string | null;
  updatedAt: string;
}

export type SideAffected = 'left' | 'right' | 'both';

/**
 * FaCE Scale (Facial Clinimetric Evaluation) — 15-item patient-reported
 * questionnaire + 2 VAS, scored into 6 domains. Scoring lives in
 * src/domain/instruments/faceScale.ts (computeFaceScale), never here — this
 * type only shapes the stored row.
 */
export interface FaceScaleResponse {
  id: UUID;
  clinicId: UUID;
  patientId: UUID;
  enrollmentId: UUID | null;
  sideAffected: SideAffected | null;
  visitLabel: string | null;
  responses: Partial<Record<number, 1 | 2 | 3 | 4 | 5>>;
  vasMovement: number | null;
  vasQol: number | null;
  domainScores: {
    facialMovement: number;
    facialComfort: number;
    oralFunction: number;
    eyeComfort: number;
    lacrimalControl: number;
    socialFunction: number;
  };
  totalScore: number;
  updatedAt: string;
}

/**
 * Facial Palsy grading: House–Brackmann grade (static reference lookup) +
 * Sunnybrook Facial Grading composite score. Scoring lives in
 * src/domain/instruments/facialPalsy.ts (computeSunnybrook), never here.
 */
export interface FacialPalsyAssessment {
  id: UUID;
  clinicId: UUID;
  patientId: UUID;
  enrollmentId: UUID | null;
  sideAffected: SideAffected | null;
  visitLabel: string | null;
  hbGrade: number | null;
  sunnybrookResting: Record<string, number> | null;
  sunnybrookVoluntary: Record<string, number> | null;
  sunnybrookSynkinesis: Record<string, number> | null;
  sunnybrookScore: number | null;
  synkinesisTotal: number | null;
  updatedAt: string;
}

/** clinic_members.role — matches the values enforced by DB CHECK constraints. */
export type MemberRole = 'admin' | 'staff';

/**
 * Module activation registry (Tier 1 + Tier 2): whether a clinic has a
 * module turned on, and which staff roles may use it when enabled. Tier 3
 * (per-patient) is PatientModuleEnrollment above. See
 * src/domain/modules.ts (canUseModule) for the pure gating logic both the
 * UI and this row's server-side RLS mirror.
 */
export interface ClinicModuleSetting {
  id: UUID;
  clinicId: UUID;
  moduleKey: ModuleType;
  enabled: boolean;
  allowedRoles: MemberRole[];
  config: Record<string, unknown>;
  updatedAt: string;
}

/**
 * The signed-in user's own clinic_members row, cached locally so the
 * module launcher can gate by role while offline. Read-only on the
 * client — membership itself is still managed from Setup's existing
 * admin flow, never written here. Not part of the outbox sync loop
 * (see src/sync/engine.ts's pullMyMemberships).
 */
export interface MyMembership {
  clinicId: UUID;
  role: MemberRole;
  updatedAt: string;
}
