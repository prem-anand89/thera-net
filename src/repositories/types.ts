import type {
  Clinic,
  Therapist,
  CatalogItem,
  NoReturnReasonItem,
  ReferringSourceItem,
  TreatmentItem,
  Patient,
  Visit,
  Invoice,
  InvoicePayment,
  Payment,
  Settlement,
  ConsultationNote,
  PatientModuleEnrollment,
  PatientAdvance,
  FeedbackRequest,
  NoteMode,
  UUID,
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
  put(visit: Visit): Promise<void>;
  softDelete(id: UUID): Promise<void>;
  /** Local stamp after the server-side issue_invoice RPC succeeds */
  markInvoiced(ids: UUID[], invoiceId: UUID): Promise<void>;
}

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
}

export interface SettlementRepo {
  getByPeriod(clinicId: UUID, year: number, month: number): Promise<Settlement | undefined>;
  list(clinicId: UUID): Promise<Settlement[]>;
  put(settlement: Settlement): Promise<void>;
}

export interface PaymentRepo {
  get(id: UUID): Promise<Payment | undefined>;
  list(clinicId: UUID): Promise<Payment[]>;
  listByDate(clinicId: UUID, date: string): Promise<Payment[]>;
  listByVisit(visitId: UUID): Promise<Payment[]>;
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
  put(request: FeedbackRequest): Promise<void>;
  /** Caches a server-confirmed row (e.g. the RPC-based token rotation
   *  below) without re-queuing an outbox push of our own. */
  putLocal(request: FeedbackRequest): Promise<void>;
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
  invoices: InvoiceRepo;
  invoicePayments: InvoicePaymentRepo;
  payments: PaymentRepo;
  settlements: SettlementRepo;
  consultationNotes: ConsultationNoteRepo;
  patientModuleEnrollments: PatientModuleEnrollmentRepo;
  patientAdvances: PatientAdvanceRepo;
  feedbackRequests: FeedbackRequestRepo;
}
