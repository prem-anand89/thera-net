import { db, type SyncedTable } from '@/lib/db';
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
  ScreeningResponse,
  ReturnToSportResponse,
  ScoliosisScreeningResponse,
  FaceScaleResponse,
  FacialPalsyAssessment,
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
  SettlementRepo,
  ConsultationNoteRepo,
  PatientModuleEnrollmentRepo,
  ScreeningResponseRepo,
  ReturnToSportRepo,
  ScoliosisScreeningRepo,
  FaceScaleRepo,
  FacialPalsyRepo,
  ModuleSettingsRepo,
  MyMembershipRepo,
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

const consultationNotes: ConsultationNoteRepo = {
  get: (id) => db.consultation_notes.get(id),
  async list(clinicId, patientId) {
    const all = await db.consultation_notes.where('patientId').equals(patientId).toArray();
    return all
      .filter((n) => n.clinicId === clinicId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  put: (note) => putWithOutbox('consultation_notes', note),
};

const moduleEnrollments: PatientModuleEnrollmentRepo = {
  get: (id) => db.patient_module_enrollments.get(id),
  async list(clinicId, patientId) {
    const all = await db.patient_module_enrollments.where('patientId').equals(patientId).toArray();
    return all
      .filter((e) => e.clinicId === clinicId)
      .sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt));
  },
  async listByModule(clinicId, moduleType) {
    const all = await db.patient_module_enrollments.where('moduleType').equals(moduleType).toArray();
    return all.filter((e) => e.clinicId === clinicId);
  },
  put: (enrollment) => putWithOutbox('patient_module_enrollments', enrollment),
};

const screeningResponses: ScreeningResponseRepo = {
  get: (id) => db.screening_responses.get(id),
  async list(clinicId, patientId) {
    const all = await db.screening_responses.where('patientId').equals(patientId).toArray();
    return all
      .filter((r) => r.clinicId === clinicId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  put: (response) => putWithOutbox('screening_responses', response),
};

const returnToSport: ReturnToSportRepo = {
  get: (id) => db.return_to_sport_responses.get(id),
  async list(clinicId, patientId) {
    const all = await db.return_to_sport_responses.where('patientId').equals(patientId).toArray();
    return all
      .filter((r) => r.clinicId === clinicId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  put: (response) => putWithOutbox('return_to_sport_responses', response),
};

const scoliosisScreening: ScoliosisScreeningRepo = {
  get: (id) => db.scoliosis_screening_responses.get(id),
  async list(clinicId, patientId) {
    const all = await db.scoliosis_screening_responses.where('patientId').equals(patientId).toArray();
    return all
      .filter((r) => r.clinicId === clinicId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  put: (response) => putWithOutbox('scoliosis_screening_responses', response),
};

const faceScale: FaceScaleRepo = {
  get: (id) => db.face_scale_responses.get(id),
  async list(clinicId, patientId) {
    const all = await db.face_scale_responses.where('patientId').equals(patientId).toArray();
    return all
      .filter((r) => r.clinicId === clinicId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  put: (response) => putWithOutbox('face_scale_responses', response),
};

const facialPalsy: FacialPalsyRepo = {
  get: (id) => db.facial_palsy_assessments.get(id),
  async list(clinicId, patientId) {
    const all = await db.facial_palsy_assessments.where('patientId').equals(patientId).toArray();
    return all
      .filter((a) => a.clinicId === clinicId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  put: (assessment) => putWithOutbox('facial_palsy_assessments', assessment),
};

const moduleSettings: ModuleSettingsRepo = {
  list: (clinicId) => db.clinic_module_settings.where('clinicId').equals(clinicId).toArray(),
  put: (setting) => putWithOutbox('clinic_module_settings', setting),
};

const myMembership: MyMembershipRepo = {
  async getRole(clinicId) {
    const row = await db.my_memberships.get(clinicId);
    return row?.role ?? null;
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
  settlements,
  consultationNotes,
  moduleEnrollments,
  screeningResponses,
  returnToSport,
  scoliosisScreening,
  faceScale,
  facialPalsy,
  moduleSettings,
  myMembership,
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
  Settlement,
  ConsultationNote,
  PatientModuleEnrollment,
  ScreeningResponse,
  ReturnToSportResponse,
  ScoliosisScreeningResponse,
  FaceScaleResponse,
  FacialPalsyAssessment,
};
