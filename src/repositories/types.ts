import type { PushCategory } from '@/domain/pushPreferences';
import type {
  SeenMarkerKey,
  UserSeenMarker,
  UserPushPreference,
  Clinic,
  Therapist,
  CatalogItem,
  NoReturnReasonItem,
  ReferringSourceItem,
  TreatmentItem,
  Patient,
  Visit,
  VisitItem,
  VisitCredit,
  Invoice,
  InvoicePayment,
  Payment,
  Settlement,
  SettlementPayment,
  ConsultationNote,
  PatientModuleEnrollment,
  PatientAdvance,
  FeedbackRequest,
  FeedbackResponse,
  AppointmentRequest,
  Appointment,
  ClinicClosedDate,
  NoteMode,
  UUID,
  ShiftTemplate,
  TherapistShiftAssignment,
} from '@/domain/types';

/**
 * Repository interfaces — the only data-access surface the services/UI see.
 * The Dexie implementations back the UI (local-first); the sync engine moves
 * data to/from Supabase behind the scenes. Swapping the backend means
 * reimplementing these interfaces, nothing above them.
 */

export interface ClinicRepo {
  get(id: UUID): Promise<Clinic | undefined>;
  list(): Promise<Clinic[]>;
  put(clinic: Clinic): Promise<void>;
  /** Local cache write for a server-created clinic (e.g. via create_clinic_with_admin RPC) — not outboxed */
  putLocal(clinic: Clinic): Promise<void>;
}

export interface TherapistRepo {
  list(clinicId: UUID, includeInactive?: boolean): Promise<Therapist[]>;
  put(therapist: Therapist): Promise<void>;
  /** Local cache removal after a server-side hard delete (not outboxed) */
  removeLocal(id: UUID): Promise<void>;
}

export interface CatalogRepo {
  list(clinicId: UUID, includeInactive?: boolean): Promise<CatalogItem[]>;
  get(id: UUID): Promise<CatalogItem | undefined>;
  put(item: CatalogItem): Promise<void>;
  /** Local cache cleanup after the server-side hard_delete_catalog_item
   *  RPC succeeds — deletes don't travel through the offline outbox. */
  removeLocal(id: UUID): Promise<void>;
}

export interface NoReturnReasonCatalogRepo {
  list(clinicId: UUID, includeInactive?: boolean): Promise<NoReturnReasonItem[]>;
  get(id: UUID): Promise<NoReturnReasonItem | undefined>;
  put(item: NoReturnReasonItem): Promise<void>;
}

export interface ReferringSourceCatalogRepo {
  list(clinicId: UUID, includeInactive?: boolean): Promise<ReferringSourceItem[]>;
  get(id: UUID): Promise<ReferringSourceItem | undefined>;
  put(item: ReferringSourceItem): Promise<void>;
}

export interface TreatmentCatalogRepo {
  list(clinicId: UUID, includeInactive?: boolean): Promise<TreatmentItem[]>;
  get(id: UUID): Promise<TreatmentItem | undefined>;
  put(item: TreatmentItem): Promise<void>;
}

export interface PatientRepo {
  get(id: UUID): Promise<Patient | undefined>;
  getByMrno(clinicId: UUID, mrno: string): Promise<Patient | undefined>;
  /** Case-insensitive match on MRNO prefix or name substring; hidden patients excluded */
  search(clinicId: UUID, query: string, limit?: number): Promise<Patient[]>;
  /** Includes hidden patients — callers that render pickers should filter deletedAt */
  list(clinicId: UUID): Promise<Patient[]>;
  put(patient: Patient): Promise<void>;
  /** Local cache removal after a server-side hard delete (not outboxed) */
  removeLocal(id: UUID): Promise<void>;
}

export interface VisitFilter {
  clinicId: UUID;
  from?: string;
  to?: string;
  therapistId?: UUID;
  patientId?: UUID;
}

export interface VisitRepo {
  get(id: UUID): Promise<Visit | undefined>;
  list(filter: VisitFilter): Promise<Visit[]>;
  listByIds(ids: UUID[]): Promise<Visit[]>;
  listByPackageGroup(packageGroupId: UUID): Promise<Visit[]>;
  listByInvoiceId(invoiceId: UUID): Promise<Visit[]>;
  /** Gates whether a catalog item has ever been used (and so can only be
   *  deactivated, not hard-deleted): visits on it plus live service lines on it. */
  countByService(serviceCatalogId: UUID): Promise<number>;
  put(visit: Visit): Promise<void>;
  /**
   * Writes a visit with its service lines and revenue shares in ONE transaction, and queues them for
   * sync in that order — visit, then lines (in array order), then shares — so the parent reaches the
   * server before its children. `itemsFirst` queues the lines before the visit row instead. The server
   * does not need that order (it only checks assistant != primary on the line write itself); it is a
   * harmless safety ordering used when a primary change also clears an assistant tag, so no pushed state
   * ever has the new primary and the old tag side by side.
   */
  putWithChildren(
    visit: Visit,
    items: VisitItem[],
    credits: VisitCredit[],
    opts?: { itemsFirst?: boolean }
  ): Promise<void>;
  softDelete(id: UUID): Promise<void>;
  /** Local stamp after the server-side issue_invoice RPC succeeds */
  markInvoiced(ids: UUID[], invoiceId: UUID): Promise<void>;
  /** Mirrors void_invoice() locally: the visits are released from their invoice. */
  markUninvoiced(ids: UUID[]): Promise<void>;
}

/**
 * A visit's child rows (service lines, revenue shares). Reads skip soft-deleted rows. `range` is a
 * visit-date range (inclusive yyyy-mm-dd): only rows whose visit falls in it (and isn't deleted).
 */
export interface VisitChildRepo<T> {
  listByVisitIds(ids: UUID[]): Promise<T[]>;
  listByClinic(clinicId: UUID, range?: { from: string; to: string }): Promise<T[]>;
  /**
   * Every row of the clinic, soft-deleted ones INCLUDED. Only for "is anything still pointing at this?"
   * checks (a soft-deleted row still holds its foreign keys on the server, e.g. deleting a therapist).
   */
  listByClinicIncludingDeleted(clinicId: UUID): Promise<T[]>;
  /** Writes every row and queues each for sync, in one transaction. */
  bulkPut(rows: T[]): Promise<void>;
}

export type VisitItemRepo = VisitChildRepo<VisitItem>;
export type VisitCreditRepo = VisitChildRepo<VisitCredit>;

export interface InvoiceRepo {
  get(id: UUID): Promise<Invoice | undefined>;
  list(clinicId: UUID): Promise<Invoice[]>;
  /** Local cache write for a server-issued invoice (not outboxed) */
  putLocal(invoice: Invoice): Promise<void>;
}

export interface InvoicePaymentRepo {
  getByInvoiceId(invoiceId: UUID): Promise<InvoicePayment | undefined>;
  list(clinicId: UUID): Promise<InvoicePayment[]>;
  put(payment: InvoicePayment): Promise<void>;
  /** Local-only write for a change the server already made (void_invoice()). */
  putLocal(payment: InvoicePayment): Promise<void>;
}

export interface SettlementRepo {
  getByPeriod(clinicId: UUID, year: number, month: number): Promise<Settlement | undefined>;
  list(clinicId: UUID): Promise<Settlement[]>;
  put(settlement: Settlement): Promise<void>;
}

export interface SettlementPaymentRepo {
  listByPeriod(clinicId: UUID, year: number, month: number): Promise<SettlementPayment[]>;
  list(clinicId: UUID): Promise<SettlementPayment[]>;
  put(payment: SettlementPayment): Promise<void>;
  delete(id: UUID): Promise<void>;
}

export interface PaymentRepo {
  get(id: UUID): Promise<Payment | undefined>;
  list(clinicId: UUID): Promise<Payment[]>;
  listByDate(clinicId: UUID, date: string): Promise<Payment[]>;
  listByVisit(visitId: UUID): Promise<Payment[]>;
  /** Every payment drawn from one advance (indexed). */
  listByAdvanceId(advanceId: UUID): Promise<Payment[]>;
  put(payment: Payment): Promise<void>;
  delete(id: UUID): Promise<void>;
}

export interface ConsultationNoteRepo {
  get(id: UUID): Promise<ConsultationNote | undefined>;
  /** All notes for a patient, most-recently-updated first. */
  listByPatient(clinicId: UUID, patientId: UUID): Promise<ConsultationNote[]>;
  /** Every note in the clinic — used for full-clinic export (backup). */
  listByClinic(clinicId: UUID): Promise<ConsultationNote[]>;
  /**
   * The open draft matching `modes` for a patient, if one exists. A
   * patient can have an open heavy draft AND one or more open light
   * (session) drafts simultaneously (one per undocumented visit) — `modes`
   * disambiguates which kind the caller wants; `visitId`, when given,
   * further scopes to that specific visit's draft (only meaningful for
   * session notes, which always carry a visitId). Without `visitId`, the
   * first matching draft for the patient wins, same as the original
   * one-draft-at-a-time behavior.
   */
  getOpenDraft(
    clinicId: UUID,
    patientId: UUID,
    modes: NoteMode[],
    visitId?: UUID | null
  ): Promise<ConsultationNote | undefined>;
  /** Notes under one enrollment (episode of care) — an empty result means
   *  the next note written is Initial, a non-empty one means Follow-up. */
  listByEnrollment(enrollmentId: UUID): Promise<ConsultationNote[]>;
  /**
   * The note to pre-fill an invoice's clinical snapshot from — prefers this
   * visit's own note; a light session note has no `referral` field (Phase
   * 2), so callers wanting referral/diagnosis fields fall back to the
   * patient's most recent completed heavy note themselves via
   * `listByPatient` when this returns one with no useful fields.
   */
  getByVisitId(visitId: UUID): Promise<ConsultationNote | undefined>;
  put(note: ConsultationNote): Promise<void>;
}

export interface PatientModuleEnrollmentRepo {
  get(id: UUID): Promise<PatientModuleEnrollment | undefined>;
  /** All enrollments for a patient in a given module, oldest first — the
   *  first one is the episode Initial/Follow-up note-mode detection anchors on. */
  listByPatient(
    clinicId: UUID,
    patientId: UUID,
    moduleType: PatientModuleEnrollment['moduleType']
  ): Promise<PatientModuleEnrollment[]>;
  /** The active enrollment for a patient in a module, if one exists. */
  getActive(
    clinicId: UUID,
    patientId: UUID,
    moduleType: PatientModuleEnrollment['moduleType']
  ): Promise<PatientModuleEnrollment | undefined>;
  /** Every enrollment in the clinic for a module, any status. */
  listByClinic(
    clinicId: UUID,
    moduleType: PatientModuleEnrollment['moduleType']
  ): Promise<PatientModuleEnrollment[]>;
  put(enrollment: PatientModuleEnrollment): Promise<void>;
}

export interface PatientAdvanceRepo {
  get(id: UUID): Promise<PatientAdvance | undefined>;
  /** A patient's advances, most-recently-received first. */
  listByPatient(clinicId: UUID, patientId: UUID): Promise<PatientAdvance[]>;
  /** Advances received on one date (YYYY-MM-DD) — the Daybook's second source. */
  listByDate(clinicId: UUID, date: string): Promise<PatientAdvance[]>;
  put(advance: PatientAdvance): Promise<void>;
}

export interface FeedbackRequestRepo {
  /** At most one row can be relevant to a card at a time — the schema's
   *  own unique-pending-per-visit index means the interesting question is
   *  always "the" request for this visit, not a list of them. Returns the
   *  most recently updated row if a visit somehow has more than one
   *  (e.g. an old responded/expired row plus today's pending one). */
  getByVisitId(clinicId: UUID, visitId: UUID): Promise<FeedbackRequest | undefined>;
  /** Every request for a clinic, for building a visitId-keyed lookup map
   *  in bulk (VisitCardData builders) instead of one query per row. */
  listByClinic(clinicId: UUID): Promise<FeedbackRequest[]>;
  /** Caches a server-confirmed row — both creating and resending a request
   *  go through online-only RPCs (`create_feedback_request`,
   *  `rotate_feedback_request_token`), so there's no outbox-writing `put`
   *  on this repo, only this local cache write. */
  putLocal(request: FeedbackRequest): Promise<void>;
}

/** Read-only: a response is only ever written by the anonymous patient's
 *  own SECURITY DEFINER RPC call, never by the client — same shape as
 *  `InvoiceRepo` minus `putLocal`, since nothing here ever needs to cache
 *  a just-created row ahead of the next sync pull. */
export interface FeedbackResponseRepo {
  listByClinic(clinicId: UUID): Promise<FeedbackResponse[]>;
}

/** Read-only, same reasoning as `FeedbackResponseRepo` — every write on
 *  either booking table (Slice 5) is an online-only RPC, never a Dexie
 *  put; see `src/services/bookingService.ts`. */
export interface AppointmentRequestRepo {
  listByClinic(clinicId: UUID): Promise<AppointmentRequest[]>;
}

export interface AppointmentRepo {
  listByClinic(clinicId: UUID): Promise<Appointment[]>;
}

/** Read-only; live rows only (soft-deleted closures are filtered out). */
export interface ClinicClosedDateRepo {
  listByClinic(clinicId: UUID): Promise<ClinicClosedDate[]>;
}

export interface ShiftTemplatesRepo {
  list(clinicId: UUID, includeInactive?: boolean): Promise<ShiftTemplate[]>;
}

export interface TherapistShiftAssignmentsRepo {
  listByClinic(clinicId: UUID): Promise<TherapistShiftAssignment[]>;
  listByTherapist(therapistId: UUID): Promise<TherapistShiftAssignment[]>;
}

export interface UserSeenMarkersRepo {
  get(userId: UUID, clinicId: UUID, key: SeenMarkerKey): Promise<UserSeenMarker | undefined>;
  /** Moves the marker forward to `at` (default now). A no-op when it is already at or past `at`, so it never goes backwards. */
  markSeen(userId: UUID, clinicId: UUID, key: SeenMarkerKey, at?: string): Promise<void>;
}

export interface UserPushPreferencesRepo {
  /** Every explicit choice this user has made in this clinic. A missing alert means "on". */
  listForUser(userId: UUID, clinicId: UUID): Promise<UserPushPreference[]>;
  setEnabled(userId: UUID, clinicId: UUID, category: PushCategory, enabled: boolean): Promise<void>;
}

export interface Repos {
  clinics: ClinicRepo;
  therapists: TherapistRepo;
  catalog: CatalogRepo;
  noReturnReasonCatalog: NoReturnReasonCatalogRepo;
  referringSourceCatalog: ReferringSourceCatalogRepo;
  treatmentCatalog: TreatmentCatalogRepo;
  patients: PatientRepo;
  visits: VisitRepo;
  visitItems: VisitItemRepo;
  visitCredits: VisitCreditRepo;
  invoices: InvoiceRepo;
  invoicePayments: InvoicePaymentRepo;
  payments: PaymentRepo;
  settlements: SettlementRepo;
  settlementPayments: SettlementPaymentRepo;
  consultationNotes: ConsultationNoteRepo;
  patientModuleEnrollments: PatientModuleEnrollmentRepo;
  patientAdvances: PatientAdvanceRepo;
  feedbackRequests: FeedbackRequestRepo;
  feedbackResponses: FeedbackResponseRepo;
  appointmentRequests: AppointmentRequestRepo;
  appointments: AppointmentRepo;
  clinicClosedDates: ClinicClosedDateRepo;
  shiftTemplates: ShiftTemplatesRepo;
  therapistShiftAssignments: TherapistShiftAssignmentsRepo;
  userSeenMarkers: UserSeenMarkersRepo;
  userPushPreferences: UserPushPreferencesRepo;
}
