import Dexie, { type Table } from 'dexie';
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
  | 'payments'
  | 'settlements';

/**
 * Tables the client is allowed to write. Invoices are server-issued only.
 */
export const CLIENT_WRITABLE_TABLES = [
  'clinics',
  'therapists',
  'service_catalog',
  'patients',
  'visits',
  'invoice_payments',
  'payments',
  'settlements',
] as const satisfies readonly SyncedTable[];

export class ClinicDB extends Dexie {
  clinics!: Table<Clinic, string>;
  therapists!: Table<Therapist, string>;
  service_catalog!: Table<CatalogItem, string>;
  patients!: Table<Patient, string>;
  visits!: Table<Visit, string>;
  invoices!: Table<Invoice, string>;
  invoice_payments!: Table<InvoicePayment, string>;
  payments!: Table<Payment, string>;
  settlements!: Table<Settlement, string>;
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
  }
}

export const db = new ClinicDB();
