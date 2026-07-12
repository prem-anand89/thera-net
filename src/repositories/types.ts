import type {
  Clinic,
  Therapist,
  CatalogItem,
  Patient,
  Visit,
  Invoice,
  InvoicePayment,
  Payment,
  Settlement,
  ConsultationNote,
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

export interface PaymentRepo {
  get(id: UUID): Promise<Payment | undefined>;
  list(clinicId: UUID): Promise<Payment[]>;
  listByDate(clinicId: UUID, date: string): Promise<Payment[]>;
  listByVisit(visitId: UUID): Promise<Payment[]>;
  put(payment: Payment): Promise<void>;
  delete(id: UUID): Promise<void>;
}

export interface Repos {
  clinics: ClinicRepo;
  therapists: TherapistRepo;
  catalog: CatalogRepo;
  patients: PatientRepo;
  visits: VisitRepo;
  invoices: InvoiceRepo;
  invoicePayments: InvoicePaymentRepo;
  payments: PaymentRepo;
  settlements: SettlementRepo;
  consultationNotes: ConsultationNoteRepo;
}
