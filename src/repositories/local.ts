import { db, type SyncedTable } from '@/lib/db';
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
  UUID,
} from '@/domain/types';
import { coerceReferringSource } from '@/domain/types';
import type {
  ClinicRepo,
  TherapistRepo,
  CatalogRepo,
  NoReturnReasonCatalogRepo,
  ReferringSourceCatalogRepo,
  TreatmentCatalogRepo,
  PatientRepo,
  VisitRepo,
  VisitFilter,
  InvoiceRepo,
  InvoicePaymentRepo,
  PaymentRepo,
  SettlementRepo,
  ConsultationNoteRepo,
  PatientModuleEnrollmentRepo,
  PatientAdvanceRepo,
  FeedbackRequestRepo,
  FeedbackResponseRepo,
  AppointmentRequestRepo,
  AppointmentRepo,
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
  putLocal: async (clinic) => {
    await db.clinics.put(clinic);
  },
};

const therapists: TherapistRepo = {
  async list(clinicId, includeInactive = false) {
    const all = await db.therapists.where('clinicId').equals(clinicId).toArray();
    return all
      .filter((t) => includeInactive || t.active)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  put: (t) => putWithOutbox('therapists', t),
  removeLocal: async (id) => {
    await db.therapists.delete(id);
  },
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

const noReturnReasonCatalog: NoReturnReasonCatalogRepo = {
  async list(clinicId, includeInactive = false) {
    const all = await db.no_return_reason_catalog.where('clinicId').equals(clinicId).toArray();
    return all
      .filter((r) => includeInactive || r.active)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  get: (id) => db.no_return_reason_catalog.get(id),
  put: (item) => putWithOutbox('no_return_reason_catalog', item),
};

const referringSourceCatalog: ReferringSourceCatalogRepo = {
  async list(clinicId, includeInactive = false) {
    const all = await db.referring_source_catalog.where('clinicId').equals(clinicId).toArray();
    return all
      .filter((r) => includeInactive || r.active)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  get: (id) => db.referring_source_catalog.get(id),
  put: (item) => putWithOutbox('referring_source_catalog', item),
};

const treatmentCatalog: TreatmentCatalogRepo = {
  async list(clinicId, includeInactive = false) {
    const all = await db.treatment_catalog.where('clinicId').equals(clinicId).toArray();
    return all
      .filter((r) => includeInactive || r.active)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  get: (id) => db.treatment_catalog.get(id),
  put: (item) => putWithOutbox('treatment_catalog', item),
};

const patients: PatientRepo = {
  get: (id) => db.patients.get(id),
  getByMrno: (clinicId, mrno) =>
    db.patients.where('[clinicId+mrno]').equals([clinicId, mrno]).first(),
  async search(clinicId, query, limit = 15) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // Phone matching runs on digits only, so "98765 43210", "+91 98765-43210",
    // and "9876543210" all find the same patient regardless of how either
    // side was formatted. A short query (e.g. "98") still requires 3+ digits
    // to avoid matching every record's area code by accident.
    const qDigits = q.replace(/\D/g, '');
    const all = await db.patients.where('clinicId').equals(clinicId).toArray();
    return all
      .filter((p) => !p.deletedAt)
      .filter(
        (p) =>
          p.mrno.toLowerCase().startsWith(q) ||
          p.name.toLowerCase().includes(q) ||
          (qDigits.length >= 3 && (p.phone ?? '').replace(/\D/g, '').includes(qDigits))
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
  },
  async list(clinicId) {
    const all = await db.patients.where('clinicId').equals(clinicId).toArray();
    return all.sort((a, b) => a.name.localeCompare(b.name));
  },
  put: (p) =>
    putWithOutbox('patients', { ...p, referringSource: coerceReferringSource(p.referringSource) }),
  removeLocal: async (id) => {
    await db.patients.delete(id);
  },
};

const visits: VisitRepo = {
  get: (id) => db.visits.get(id),
  async list(filter: VisitFilter) {
    // A date range (Workspace's "today", Ledger's date presets, dashboard
    // aggregations) can go straight to the matching rows via the compound
    // index instead of loading the clinic's entire visit history and
    // filtering in memory. An open-ended range still needs a bound on each
    // side, so a missing `from`/`to` is filled with a value date never goes
    // below/above.
    let rows: Visit[];
    if (filter.from || filter.to) {
      const from = filter.from ?? '0000-00-00';
      const to = filter.to ?? '9999-99-99';
      rows = await db.visits
        .where('[clinicId+visitDate]')
        .between([filter.clinicId, from], [filter.clinicId, to], true, true)
        .toArray();
    } else {
      rows = await db.visits.where('clinicId').equals(filter.clinicId).toArray();
    }
    rows = rows.filter((v) => !v.deleted);
    if (filter.therapistId) rows = rows.filter((v) => v.therapistId === filter.therapistId);
    if (filter.patientId) rows = rows.filter((v) => v.patientId === filter.patientId);
    return rows.sort(
      (a, b) => b.visitDate.localeCompare(a.visitDate) || b.updatedAt.localeCompare(a.updatedAt)
    );
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
    if (visit.invoiceId)
      throw new Error('This visit is on an issued invoice and cannot be deleted.');
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

const consultationNotes: ConsultationNoteRepo = {
  get: (id) => db.consultation_notes.get(id),
  async listByPatient(clinicId, patientId) {
    const all = await db.consultation_notes.where('patientId').equals(patientId).toArray();
    return all
      .filter((n) => n.clinicId === clinicId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async listByClinic(clinicId) {
    const all = await db.consultation_notes.where('clinicId').equals(clinicId).toArray();
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async getOpenDraft(clinicId, patientId, modes, visitId) {
    const all = await this.listByPatient(clinicId, patientId);
    return all.find(
      (n) =>
        n.status === 'draft' &&
        modes.includes(n.noteMode ?? 'initial') &&
        (visitId == null || n.visitId === visitId)
    );
  },
  async listByEnrollment(enrollmentId) {
    const all = await db.consultation_notes.where('enrollmentId').equals(enrollmentId).toArray();
    return all.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  },
  async getByVisitId(visitId) {
    const all = await db.consultation_notes.where('visitId').equals(visitId).toArray();
    if (all.length === 0) return undefined;
    return (
      all.find((n) => n.status === 'completed') ??
      all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    );
  },
  put: (note) => putWithOutbox('consultation_notes', note),
};

const patientModuleEnrollments: PatientModuleEnrollmentRepo = {
  get: (id) => db.patient_module_enrollments.get(id),
  async listByPatient(clinicId, patientId, moduleType) {
    const all = await db.patient_module_enrollments.where('patientId').equals(patientId).toArray();
    return all
      .filter((e) => e.clinicId === clinicId && e.moduleType === moduleType)
      .sort((a, b) => a.enrolledAt.localeCompare(b.enrolledAt));
  },
  async getActive(clinicId, patientId, moduleType) {
    const all = await this.listByPatient(clinicId, patientId, moduleType);
    return all.find((e) => e.status === 'active');
  },
  async listByClinic(clinicId, moduleType) {
    const all = await db.patient_module_enrollments.where('clinicId').equals(clinicId).toArray();
    return all.filter((e) => e.moduleType === moduleType);
  },
  put: (enrollment) => putWithOutbox('patient_module_enrollments', enrollment),
};

const patientAdvances: PatientAdvanceRepo = {
  get: (id) => db.patient_advances.get(id),
  async listByPatient(clinicId, patientId) {
    const all = await db.patient_advances.where('patientId').equals(patientId).toArray();
    return all
      .filter((a) => a.clinicId === clinicId && !a.deleted)
      .sort((a, b) => b.receivedDate.localeCompare(a.receivedDate));
  },
  put: (advance) => putWithOutbox('patient_advances', advance),
};

const feedbackRequests: FeedbackRequestRepo = {
  async getByVisitId(clinicId, visitId) {
    const all = await db.feedback_requests.where('visitId').equals(visitId).toArray();
    return all
      .filter((r) => r.clinicId === clinicId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  },
  listByClinic: (clinicId) => db.feedback_requests.where('clinicId').equals(clinicId).toArray(),
  put: (request) => putWithOutbox('feedback_requests', request),
  putLocal: async (request) => {
    await db.feedback_requests.put(request);
  },
};

const feedbackResponses: FeedbackResponseRepo = {
  listByClinic: (clinicId) => db.feedback_responses.where('clinicId').equals(clinicId).toArray(),
};

const appointmentRequests: AppointmentRequestRepo = {
  listByClinic: (clinicId) => db.appointment_requests.where('clinicId').equals(clinicId).toArray(),
};

const appointments: AppointmentRepo = {
  listByClinic: (clinicId) => db.appointments.where('clinicId').equals(clinicId).toArray(),
};

export const repos: Repos = {
  clinics,
  therapists,
  catalog,
  noReturnReasonCatalog,
  referringSourceCatalog,
  treatmentCatalog,
  patients,
  visits,
  invoices,
  invoicePayments,
  payments,
  settlements,
  consultationNotes,
  patientModuleEnrollments,
  patientAdvances,
  feedbackRequests,
  feedbackResponses,
  appointmentRequests,
  appointments,
};

// Narrow re-exports used by the sync engine and UI helpers
export type {
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
};
