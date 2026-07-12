import { describe, beforeEach, expect, it, vi } from 'vitest';
import { createBackupService } from './backupService';
import type { Repos } from '@/repositories/types';
import type {
  CatalogItem,
  Clinic,
  ConsultationNote,
  Invoice,
  InvoicePayment,
  Patient,
  Payment,
  Settlement,
  Therapist,
  Visit,
} from '@/domain/types';

// db.consultation_notes is queried directly by backupService (no
// clinic-wide list method on the repo). Stub just enough of Dexie's
// chained query API for that one call.
vi.mock('@/lib/db', () => ({
  db: {
    consultation_notes: {
      where: () => ({
        equals: () => ({
          toArray: async () => [] as ConsultationNote[],
        }),
      }),
    },
  },
}));

function makeFakeRepos() {
  const clinic: Clinic = {
    id: 'clinic-1',
    name: 'Beyond Mechanics',
    address: null,
    phone: null,
    email: null,
    gstNo: null,
    logoPath: null,
    partnerHospitalName: null,
    partnerHospitalLogoPath: null,
    invoicePrefix: 'BM',
    bmSplitPct: 75,
    taxPct: 10,
    tdsBasis: 'gross_bill',
    fyStartMonth: 4,
    updatedAt: '',
  };
  const therapists: Therapist[] = [];
  const catalog: CatalogItem[] = [];
  const patients = new Map<string, Patient>();
  const visits = new Map<string, Visit>();
  const invoices = new Map<string, Invoice>();
  const invoicePayments = new Map<string, InvoicePayment>();
  const payments = new Map<string, Payment>();
  const settlements = new Map<string, Settlement>();
  const consultationNotes = new Map<string, ConsultationNote>();

  const repos = {
    clinics: { get: async (id: string) => (id === clinic.id ? clinic : undefined) },
    therapists: { list: async () => therapists, put: async (t: Therapist) => void therapists.push(t) },
    catalog: { list: async () => catalog, put: async (c: CatalogItem) => void catalog.push(c) },
    patients: {
      list: async () => [...patients.values()],
      put: async (p: Patient) => void patients.set(p.id, p),
    },
    visits: {
      list: async () => [...visits.values()],
      put: async (v: Visit) => void visits.set(v.id, v),
    },
    invoices: {
      list: async () => [...invoices.values()],
      putLocal: async (inv: Invoice) => void invoices.set(inv.id, inv),
    },
    invoicePayments: {
      list: async () => [...invoicePayments.values()],
      put: async (p: InvoicePayment) => void invoicePayments.set(p.id, p),
    },
    payments: {
      list: async () => [...payments.values()],
      put: async (p: Payment) => void payments.set(p.id, p),
    },
    settlements: {
      list: async () => [...settlements.values()],
      put: async (s: Settlement) => void settlements.set(s.id, s),
    },
    consultationNotes: {
      put: async (n: ConsultationNote) => void consultationNotes.set(n.id, n),
    },
  } as unknown as Repos;

  return { repos, clinic, patients, visits, invoices, invoicePayments, payments, settlements, consultationNotes };
}

describe('backupService.exportBundle', () => {
  it('bundles clinic-scoped data with a version and export timestamp', async () => {
    const fake = makeFakeRepos();
    fake.patients.set('pat-1', {
      id: 'pat-1',
      clinicId: 'clinic-1',
      mrno: '1001',
      mrnoSource: 'hospital',
      name: 'Test Patient',
      age: 40,
      sex: 'F',
      phone: null,
      primaryCondition: null,
      deletedAt: null,
      updatedAt: '',
    });
    const svc = createBackupService(fake.repos);
    const bundle = await svc.exportBundle('clinic-1');
    expect(bundle.version).toBe(1);
    expect(bundle.clinicId).toBe('clinic-1');
    expect(bundle.patients).toHaveLength(1);
    expect(bundle.exportedAt).toBeTruthy();
  });

  it('throws when the clinic does not exist', async () => {
    const fake = makeFakeRepos();
    const svc = createBackupService(fake.repos);
    await expect(svc.exportBundle('missing-clinic')).rejects.toThrow('Clinic not found');
  });
});

describe('backupService.restoreBundle', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('rejects a bundle from a different clinic', async () => {
    const svc = createBackupService(fake.repos);
    const bundle = await svc.exportBundle('clinic-1');
    await expect(svc.restoreBundle(bundle, 'clinic-2')).rejects.toThrow(/different clinic/);
  });

  it('rejects an unsupported backup version', async () => {
    const svc = createBackupService(fake.repos);
    const bundle = await svc.exportBundle('clinic-1');
    await expect(svc.restoreBundle({ ...bundle, version: 99 }, 'clinic-1')).rejects.toThrow(/version/);
  });

  it('restores every table and reports accurate counts', async () => {
    const svc = createBackupService(fake.repos);
    const bundle = await svc.exportBundle('clinic-1');
    bundle.patients.push({
      id: 'pat-2',
      clinicId: 'clinic-1',
      mrno: '1002',
      mrnoSource: 'auto',
      name: 'Restored Patient',
      age: null,
      sex: null,
      phone: null,
      primaryCondition: null,
      deletedAt: null,
      updatedAt: '',
    });
    const summary = await svc.restoreBundle(bundle, 'clinic-1');
    expect(summary.patients).toBe(1);
    expect(await fake.repos.patients.list('clinic-1')).toHaveLength(1);
  });
});
