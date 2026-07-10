import Dexie, { type Table } from 'dexie';
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
}

export interface MetaEntry {
  key: string;
  value: string;
}

export type SyncedTable =
  | 'clinics'
  | 'therapists'
  | 'service_catalog'
  | 'patients'
  | 'visits'
  | 'invoices'
  | 'invoice_payments'
  | 'settlements'
  | 'consultation_notes';

/**
 * Tables the client is allowed to write. Invoices are server-issued only.
 * consultation_notes is therapist-authored but still client-writable (the
 * therapist finishing the note is the client); it's excluded from
 * server-only status only in the sense that no RPC mints it — RLS still
 * gates who can write which row.
 */
export const CLIENT_WRITABLE_TABLES = [
  'clinics',
  'therapists',
  'service_catalog',
  'patients',
  'visits',
  'invoice_payments',
  'settlements',
  'consultation_notes',
] as const satisfies readonly SyncedTable[];

export class ClinicDB extends Dexie {
  clinics!: Table<Clinic, string>;
  therapists!: Table<Therapist, string>;
  service_catalog!: Table<CatalogItem, string>;
  patients!: Table<Patient, string>;
  visits!: Table<Visit, string>;
  invoices!: Table<Invoice, string>;
  invoice_payments!: Table<InvoicePayment, string>;
  settlements!: Table<Settlement, string>;
  consultation_notes!: Table<ConsultationNote, string>;
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
    this.version(3).stores({
      consultation_notes: 'id, clinicId, patientId, therapistId',
      patient_module_enrollments: 'id, clinicId, patientId, moduleType',
      screening_responses: 'id, clinicId, patientId',
      return_to_sport_responses: 'id, clinicId, patientId',
      scoliosis_screening_responses: 'id, clinicId, patientId',
    });
    this.version(4).stores({
      face_scale_responses: 'id, clinicId, patientId',
      facial_palsy_assessments: 'id, clinicId, patientId',
    });
    this.version(5).stores({
      clinic_module_settings: 'id, clinicId, moduleKey, [clinicId+moduleKey]',
      // Keyed by clinicId (not id) — one row per clinic the signed-in user
      // belongs to, written only by the sync engine's read-only pull.
      my_memberships: 'clinicId',
    });
  }
}

export const db = new ClinicDB();
