import Dexie, { type Table } from 'dexie';
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
} from '@/domain/types';

/**
 * Queued local mutation awaiting push to Supabase. Only the row id is stored —
 * the current row state is read from Dexie at push time, so rapid edits to the
 * same row coalesce into one upsert.
 */
export interface OutboxEntry {
  seq?: number;
  table: SyncedTable;
  rowId: string;
  ts: number;
  /** Last push error, if any — kept visible instead of dropped */
  error?: string;
  /**
   * Postgrest/Postgres error code for `error`, when the rejection carried
   * one (e.g. '42501' for an RLS permission denial). Lets the UI tell a
   * permanent rejection (retrying will never succeed) apart from a
   * transient one, instead of showing the same "keep retrying" copy for
   * both — see SyncBadge.
   */
  errorCode?: string;
}

export interface MetaEntry {
  key: string;
  value: string;
}

export type SyncedTable =
  | 'clinics'
  | 'therapists'
  | 'service_catalog'
  | 'no_return_reason_catalog'
  | 'referring_source_catalog'
  | 'treatment_catalog'
  | 'patients'
  | 'visits'
  | 'invoices'
  | 'invoice_payments'
  | 'payments'
  | 'settlements'
  | 'consultation_notes'
  | 'patient_module_enrollments'
  | 'patient_advances'
  | 'feedback_requests';

/**
 * Every table the sync engine pushes/pulls — the single source of truth
 * for "what data does this app cache locally," so the push/pull loop and
 * the sign-out clear can't drift apart the way they did before (sign-out
 * left consultation_notes/patient_module_enrollments/expected_visits
 * behind because that list was hand-maintained separately). The
 * `_exhaustiveCheck` line fails to typecheck if a new SyncedTable member
 * is ever added here without being added below.
 */
export const ALL_SYNCED_TABLES = [
  'clinics',
  'therapists',
  'service_catalog',
  'no_return_reason_catalog',
  'referring_source_catalog',
  'treatment_catalog',
  'patients',
  'visits',
  'invoices',
  'invoice_payments',
  'payments',
  'settlements',
  'consultation_notes',
  'patient_module_enrollments',
  'patient_advances',
  'feedback_requests',
] as const satisfies readonly SyncedTable[];
type _AssertAllSyncedTablesCovered = SyncedTable extends (typeof ALL_SYNCED_TABLES)[number]
  ? true
  : never;
const _exhaustiveCheck: _AssertAllSyncedTablesCovered = true;
void _exhaustiveCheck;

/**
 * Tables the client is allowed to write. Invoices are server-issued only.
 */
export const CLIENT_WRITABLE_TABLES = [
  'clinics',
  'therapists',
  'service_catalog',
  'no_return_reason_catalog',
  'referring_source_catalog',
  'treatment_catalog',
  'patients',
  'visits',
  'invoice_payments',
  'payments',
  'settlements',
  'consultation_notes',
  'patient_module_enrollments',
  'patient_advances',
  'feedback_requests',
] as const satisfies readonly SyncedTable[];

export class ClinicDB extends Dexie {
  clinics!: Table<Clinic, string>;
  therapists!: Table<Therapist, string>;
  service_catalog!: Table<CatalogItem, string>;
  no_return_reason_catalog!: Table<NoReturnReasonItem, string>;
  referring_source_catalog!: Table<ReferringSourceItem, string>;
  treatment_catalog!: Table<TreatmentItem, string>;
  patients!: Table<Patient, string>;
  visits!: Table<Visit, string>;
  invoices!: Table<Invoice, string>;
  invoice_payments!: Table<InvoicePayment, string>;
  payments!: Table<Payment, string>;
  settlements!: Table<Settlement, string>;
  consultation_notes!: Table<ConsultationNote, string>;
  patient_module_enrollments!: Table<PatientModuleEnrollment, string>;
  patient_advances!: Table<PatientAdvance, string>;
  feedback_requests!: Table<FeedbackRequest, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super('thera-net');
    this.version(1).stores({
      clinics: 'id',
      therapists: 'id, clinicId',
      service_catalog: 'id, clinicId',
      patients: 'id, clinicId, [clinicId+mrno]',
      visits: 'id, clinicId, visitDate, patientId, therapistId, packageGroupId, invoiceId',
      invoices: 'id, clinicId, invoiceNo',
      outbox: '++seq, table',
      meta: 'key',
    });
    this.version(2).stores({
      invoice_payments: 'id, clinicId, invoiceId',
      settlements: 'id, clinicId, [clinicId+year+month]',
    });
    this.version(6).stores({
      payments: 'id, clinicId, visitId, receivedDate',
    });
    this.version(5).stores({
      // Keyed by clinicId (not id) — one row per clinic the signed-in user
      // belongs to, written only by the sync engine's read-only pull.
      my_memberships: 'clinicId',
    });
    this.version(7).stores({
      consultation_notes: 'id, clinicId, patientId, visitId, status',
    });
    this.version(8).stores({
      patient_module_enrollments: 'id, clinicId, patientId, moduleType, status',
      expected_visits: 'id, clinicId, visitDate, status',
      // Re-declared with enrollmentId added — Dexie index changes on an
      // existing table require the full index string at the new version.
      consultation_notes: 'id, clinicId, patientId, visitId, status, enrollmentId',
    });
    this.version(9).stores({
      no_return_reason_catalog: 'id, clinicId',
    });
    this.version(10).stores({
      // Compound index so a date-bounded query (Workspace's "today",
      // Ledger's date presets, dashboard aggregations) can jump straight to
      // the matching rows instead of loading every visit the clinic has
      // ever logged and filtering in memory.
      visits:
        'id, clinicId, visitDate, patientId, therapistId, packageGroupId, invoiceId, [clinicId+visitDate]',
    });
    this.version(11).stores({
      referring_source_catalog: 'id, clinicId',
    });
    this.version(12).stores({
      treatment_catalog: 'id, clinicId',
    });
    this.version(13).stores({
      patient_advances: 'id, clinicId, patientId, status',
    });
    // Expected-today shipped, got a Workspace section, then that section
    // was removed during a redesign without anyone dropping this table —
    // `null` is Dexie's way to delete an object store; the earlier
    // version(8) call that created it is left untouched (rewriting a past
    // version's .stores() breaks the upgrade path for anyone whose IndexedDB
    // is still on an older version).
    this.version(14).stores({
      expected_visits: null,
    });
    // my_memberships (declared at version(5) above) was scaffolded for a
    // clinic switcher but never wired to a reader or writer — the switcher
    // built later reads db.clinics.toArray() directly instead, which
    // already carries every clinic this account belongs to. Same "delete
    // unused scaffolding" precedent as expected_visits above.
    this.version(15).stores({
      my_memberships: null,
    });
    this.version(16).stores({
      // status indexed for a future "pending" filter; visitId is the
      // hot lookup path (one card row checks "does this visit already
      // have a request" per render).
      feedback_requests: 'id, clinicId, visitId, patientId, therapistId, status',
    });
  }
}

export const db = new ClinicDB();
