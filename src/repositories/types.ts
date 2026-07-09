import type {
  Clinic,
  Therapist,
  CatalogItem,
  Patient,
  Visit,
  Invoice,
  InvoicePayment,
  Settlement,
  ConsultationNote,
  PatientModuleEnrollment,
  ModuleType,
  ScreeningResponse,
  ReturnToSportResponse,
  ScoliosisScreeningResponse,
  FaceScaleResponse,
  FacialPalsyAssessment,
  ClinicModuleSetting,
  MemberRole,
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
}

export interface TherapistRepo {
  list(clinicId: UUID, includeInactive?: boolean): Promise<Therapist[]>;
  put(therapist: Therapist): Promise<void>;
}

export interface CatalogRepo {
  list(clinicId: UUID, includeInactive?: boolean): Promise<CatalogItem[]>;
  get(id: UUID): Promise<CatalogItem | undefined>;
  put(item: CatalogItem): Promise<void>;
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

export interface ConsultationNoteRepo {
  get(id: UUID): Promise<ConsultationNote | undefined>;
  list(clinicId: UUID, patientId: UUID): Promise<ConsultationNote[]>;
  put(note: ConsultationNote): Promise<void>;
}

export interface PatientModuleEnrollmentRepo {
  get(id: UUID): Promise<PatientModuleEnrollment | undefined>;
  list(clinicId: UUID, patientId: UUID): Promise<PatientModuleEnrollment[]>;
  listByModule(clinicId: UUID, moduleType: ModuleType): Promise<PatientModuleEnrollment[]>;
  put(enrollment: PatientModuleEnrollment): Promise<void>;
}

export interface ScreeningResponseRepo {
  get(id: UUID): Promise<ScreeningResponse | undefined>;
  list(clinicId: UUID, patientId: UUID): Promise<ScreeningResponse[]>;
  put(response: ScreeningResponse): Promise<void>;
}

export interface ReturnToSportRepo {
  get(id: UUID): Promise<ReturnToSportResponse | undefined>;
  list(clinicId: UUID, patientId: UUID): Promise<ReturnToSportResponse[]>;
  put(response: ReturnToSportResponse): Promise<void>;
}

export interface ScoliosisScreeningRepo {
  get(id: UUID): Promise<ScoliosisScreeningResponse | undefined>;
  list(clinicId: UUID, patientId: UUID): Promise<ScoliosisScreeningResponse[]>;
  put(response: ScoliosisScreeningResponse): Promise<void>;
}

export interface FaceScaleRepo {
  get(id: UUID): Promise<FaceScaleResponse | undefined>;
  list(clinicId: UUID, patientId: UUID): Promise<FaceScaleResponse[]>;
  put(response: FaceScaleResponse): Promise<void>;
}

export interface FacialPalsyRepo {
  get(id: UUID): Promise<FacialPalsyAssessment | undefined>;
  list(clinicId: UUID, patientId: UUID): Promise<FacialPalsyAssessment[]>;
  put(assessment: FacialPalsyAssessment): Promise<void>;
}

export interface ModuleSettingsRepo {
  /** All module rows configured for a clinic (Tier 1 + Tier 2 registry). */
  list(clinicId: UUID): Promise<ClinicModuleSetting[]>;
  /** Admin-only write; RLS rejects non-admins server-side regardless of this call. */
  put(setting: ClinicModuleSetting): Promise<void>;
}

export interface MyMembershipRepo {
  /** The signed-in user's own role in a clinic, from the local sync cache — null if not yet synced. */
  getRole(clinicId: UUID): Promise<MemberRole | null>;
}

export interface Repos {
  clinics: ClinicRepo;
  therapists: TherapistRepo;
  catalog: CatalogRepo;
  patients: PatientRepo;
  visits: VisitRepo;
  invoices: InvoiceRepo;
  invoicePayments: InvoicePaymentRepo;
  settlements: SettlementRepo;
  consultationNotes: ConsultationNoteRepo;
  moduleEnrollments: PatientModuleEnrollmentRepo;
  screeningResponses: ScreeningResponseRepo;
  returnToSport: ReturnToSportRepo;
  scoliosisScreening: ScoliosisScreeningRepo;
  faceScale: FaceScaleRepo;
  facialPalsy: FacialPalsyRepo;
  moduleSettings: ModuleSettingsRepo;
  myMembership: MyMembershipRepo;
}
