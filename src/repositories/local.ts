import { db, type SyncedTable } from '@/lib/db';
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
  UUID,
} from '@/domain/types';
import type {
  ClinicRepo,
  TherapistRepo,
  CatalogRepo,
  PatientRepo,
  VisitRepo,
  VisitFilter,
  InvoiceRepo,
  InvoicePaymentRepo,
  PaymentRepo,
  SettlementRepo,
  Repos,
} from './types';

/**
 * Local-first repositories: every write lands in Dexie plus an outbox entry
 * in the same transaction, so the UI is instant and nothing is lost offline.
 * The sync engine drains the outbox to Supabase when a connection exists.
 */

let notifySync: (() => void) | null = null;
/** The sync engine registers here so local writes trigger an immediate push attempt. */
export function onLocalWrite(cb: () => void) {
  notifySync = cb;
}

async function putWithOutbox<T extends { id: string; updatedAt: string }>(
  table: SyncedTable,
  entity: T
): Promise<void> {
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    await db.table(table).put(entity);
    await db.outbox.add({ table, rowId: entity.id, ts: Date.now() });
  });
  notifySync?.();
}

const clinics: ClinicRepo = {
  get: (id) => db.clinics.get(id),
  list: () => db.clinics.toArray(),
  put: (clinic) => putWithOutbox('clinics', clinic),
};

const therapists: TherapistRepo = {
  async list(clinicId, includeInactive = false) {
    const all = await db.therapists.where('clinicId').equals(clinicId).toArray();
    return all
      .filter((t) => includeInactive || t.active)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  put: (t) => putWithOutbox('therapists', t),
};

const catalog: CatalogRepo = {
  async list(clinicId, includeInactive = false) {
    const all = await db.service_catalog.where('clinicId').equals(clinicId).toArray();
    return all
      .filter((c) => includeInactive || c.active)
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  },
  get: (id) => db.service_catalog.get(id),
  put: (item) => putWithOutbox('service_catalog', item),
};

const patients: PatientRepo = {
  get: (id) => db.patients.get(id),
  getByMrno: (clinicId, mrno) =>
    db.patients.where('[clinicId+mrno]').equals([clinicId, mrno]).first(),
  async search(clinicId, query, limit = 15) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const all = await db.patients.where('clinicId').equals(clinicId).toArray();
    return all
      .filter((p) => !p.deletedAt)
      .filter((p) => p.mrno.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
  },
  async list(clinicId) {
    const all = await db.patients.where('clinicId').equals(clinicId).toArray();
    return all.sort((a, b) => a.name.localeCompare(b.name));
  },
  put: (p) => putWithOutbox('patients', p),
  removeLocal: async (id) => {
    await db.patients.delete(id);
  },
};

const visits: VisitRepo = {
  get: (id) => db.visits.get(id),
  async list(filter: VisitFilter) {
    let rows = await db.visits.where('clinicId').equals(filter.clinicId).toArray();
    rows = rows.filter((v) => !v.deleted);
    if (filter.from) rows = rows.filter((v) => v.visitDate >= filter.from!);
    if (filter.to) rows = rows.filter((v) => v.visitDate <= filter.to!);
    if (filter.therapistId) rows = rows.filter((v) => v.therapistId === filter.therapistId);
    if (filter.patientId) rows = rows.filter((v) => v.patientId === filter.patientId);
    return rows.sort((a, b) => b.visitDate.localeCompare(a.visitDate) || b.updatedAt.localeCompare(a.updatedAt));
  },
  async listByIds(ids) {
    const rows = await db.visits.bulkGet(ids);
    return rows.filter((v): v is Visit => Boolean(v));
  },
  async listByPackageGroup(packageGroupId) {
    const rows = await db.visits.where('packageGroupId').equals(packageGroupId).toArray();
    return rows.filter((v) => !v.deleted).sort((a, b) => a.visitDate.localeCompare(b.visitDate));
  },
  put: (v) => putWithOutbox('visits', v),
  async softDelete(id) {
    const visit = await db.visits.get(id);
    if (!visit) return;
    if (visit.invoiceId) throw new Error('This visit is on an issued invoice and cannot be deleted.');
    await putWithOutbox('visits', { ...visit, deleted: true });
  },
  async markInvoiced(ids: UUID[], invoiceId: UUID) {
    // Server already stamped these rows inside issue_invoice(); this mirrors
    // the result locally without queueing an outbox write.
    await db.transaction('rw', db.visits, async () => {
      for (const id of ids) {
        const v = await db.visits.get(id);
        if (v) await db.visits.put({ ...v, invoiceId });
      }
    });
  },
};

const invoices: InvoiceRepo = {
  get: (id) => db.invoices.get(id),
  async list(clinicId) {
    const all = await db.invoices.where('clinicId').equals(clinicId).toArray();
    return all.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  },
  putLocal: async (invoice: Invoice) => {
    await db.invoices.put(invoice);
  },
};

const invoicePayments: InvoicePaymentRepo = {
  getByInvoiceId: (invoiceId) => db.invoice_payments.where('invoiceId').equals(invoiceId).first(),
  list: (clinicId) => db.invoice_payments.where('clinicId').equals(clinicId).toArray(),
  put: (payment) => putWithOutbox('invoice_payments', payment),
};

const settlements: SettlementRepo = {
  getByPeriod: (clinicId, year, month) =>
    db.settlements.where('[clinicId+year+month]').equals([clinicId, year, month]).first(),
  list: (clinicId) => db.settlements.where('clinicId').equals(clinicId).toArray(),
  put: (settlement) => putWithOutbox('settlements', settlement),
};

const payments: PaymentRepo = {
  get: (id) => db.payments.get(id),
  async list(clinicId) {
    return db.payments.where('clinicId').equals(clinicId).toArray();
  },
  async listByDate(clinicId, date) {
    const all = await db.payments.where('clinicId').equals(clinicId).toArray();
    return all.filter((p) => p.receivedDate === date);
  },
  async listByVisit(visitId) {
    return db.payments.where('visitId').equals(visitId).toArray();
  },
  put: (payment) => putWithOutbox('payments', payment),
  delete: async (id) => {
    await db.payments.delete(id);
  },
};

export const repos: Repos = {
  clinics,
  therapists,
  catalog,
  patients,
  visits,
  invoices,
  invoicePayments,
  payments,
  settlements,
};

// Narrow re-exports used by the sync engine and UI helpers
export type {
  Clinic,
  Therapist,
  CatalogItem,
  Patient,
  Visit,
  Invoice,
  InvoicePayment,
  Payment,
  Settlement,
};
