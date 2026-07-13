import { beforeEach, describe, expect, it } from 'vitest';
import { createVisitService } from './visitService';
import { createReportService } from './reportService';
import { createPatientService } from './patientService';
import type { Repos, VisitFilter } from '@/repositories/types';
import type { CatalogItem, Clinic, Patient, Therapist, Visit } from '@/domain/types';
import { rupeesToPaise as rs } from '@/domain/money';

// In-memory Repos double — services never touch Dexie or Supabase directly,
// which is exactly what makes them testable (and the backend swappable).
function makeFakeRepos(clinicOverrides: Partial<Clinic> = {}) {
  const clinic: Clinic = {
    id: 'clinic-1',
    name: 'Beyond Mechanics',
    address: null,
    phone: null,
    email: null,
    gstNo: null,
    logoPath: null,
    partnerHospitalName: 'Health Valley',
    partnerHospitalLogoPath: null,
    invoicePrefix: 'BM',
    bmSplitPct: 75,
    taxPct: 10,
    tdsBasis: 'gross_bill',
    fyStartMonth: 4,
    updatedAt: '',
    ...clinicOverrides,
  };
  const therapists: Therapist[] = [
    { id: 'th-prem', clinicId: 'clinic-1', name: 'Prem', active: true, updatedAt: '' },
    { id: 'th-aish', clinicId: 'clinic-1', name: 'Aishwarya', active: true, updatedAt: '' },
  ];
  const catalog: CatalogItem[] = [
    {
      id: 'svc-physio3',
      clinicId: 'clinic-1',
      category: 'Physiotherapy',
      name: 'Physiotherapy 3 Days',
      sessionCount: 3,
      basePricePaise: rs(2200),
      active: true,
      updatedAt: '',
    },
    {
      id: 'svc-consult',
      clinicId: 'clinic-1',
      category: 'Consultation',
      name: 'Consultation',
      sessionCount: 1,
      basePricePaise: rs(800),
      active: true,
      updatedAt: '',
    },
  ];
  const patients = new Map<string, Patient>();
  const visits = new Map<string, Visit>();

  const repos: Repos = {
    clinics: {
      get: async (id) => (id === clinic.id ? clinic : undefined),
      list: async () => [clinic],
      put: async () => {},
    },
    therapists: {
      list: async () => therapists,
      put: async () => {},
    },
    catalog: {
      list: async () => catalog,
      get: async (id) => catalog.find((c) => c.id === id),
      put: async () => {},
    },
    patients: {
      get: async (id) => patients.get(id),
      getByMrno: async (_c, mrno) => [...patients.values()].find((p) => p.mrno === mrno),
      search: async () => [],
      list: async () => [...patients.values()],
      put: async (p) => void patients.set(p.id, p),
      removeLocal: async (id) => void patients.delete(id),
    },
    visits: {
      get: async (id) => visits.get(id),
      list: async (f: VisitFilter) =>
        [...visits.values()].filter(
          (v) =>
            !v.deleted &&
            v.clinicId === f.clinicId &&
            (!f.from || v.visitDate >= f.from) &&
            (!f.to || v.visitDate <= f.to) &&
            (!f.therapistId || v.therapistId === f.therapistId) &&
            (!f.patientId || v.patientId === f.patientId)
        ),
      listByIds: async (ids) => ids.map((id) => visits.get(id)!).filter(Boolean),
      listByPackageGroup: async (gid) =>
        [...visits.values()].filter((v) => v.packageGroupId === gid && !v.deleted),
      put: async (v) => void visits.set(v.id, v),
      softDelete: async (id) => {
        const v = visits.get(id);
        if (v) visits.set(id, { ...v, deleted: true });
      },
      markInvoiced: async () => {},
    },
    invoices: {
      get: async () => undefined,
      list: async () => [],
      putLocal: async () => {},
    },
    invoicePayments: {
      getByInvoiceId: async () => undefined,
      list: async () => [],
      put: async () => {},
    },
    payments: {
      get: async () => undefined,
      list: async () => [],
      listByDate: async () => [],
      listByVisit: async () => [],
      put: async () => {},
      delete: async () => {},
    },
    settlements: {
      getByPeriod: async () => undefined,
      list: async () => [],
      put: async () => {},
    },
  };
  return { repos, visits };
}

describe('visitService.create', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  const base = {
    clinicId: 'clinic-1',
    patientId: 'pat-1',
    therapistId: 'th-prem',
    visitDate: '2026-05-04',
    serviceCatalogId: 'svc-physio3',
  };

  it('autofills the catalog price and snapshots rates + splits', async () => {
    const v = await createVisitService(fake.repos).create(base);
    expect(v.catalogPricePaise).toBe(rs(2200));
    expect(v.actualBillPaise).toBe(rs(2200));
    expect(v.adjustmentPaise).toBe(0);
    expect(v.bmSplitPct).toBe(75);
    expect(v.tdsBasis).toBe('gross_bill');
    expect(v.bmSharePaise).toBe(rs(1650));
    expect(v.postTaxPaise).toBe(rs(1485)); // matches charges sheet SELF SHARE
    expect(v.tdsPaise).toBe(rs(220));
    // 3-day package auto-tracks sessions
    expect(v.sessionIndex).toBe(1);
    expect(v.packageTotal).toBe(3);
    expect(v.packageGroupId).toBeTruthy();
  });

  it('requires a reason for any price override, and records the variance', async () => {
    const svc = createVisitService(fake.repos);
    await expect(svc.create({ ...base, actualBillPaise: rs(2000) })).rejects.toThrow(/reason/);

    const v = await svc.create({
      ...base,
      actualBillPaise: rs(2000),
      adjustmentReason: 'loyalty discount',
    });
    expect(v.catalogPricePaise).toBe(rs(2200)); // catalog stays clean
    expect(v.adjustmentPaise).toBe(rs(-200));
    expect(v.adjustmentReason).toBe('loyalty discount');
  });

  it('treats ₹0 continuation sessions as normal data, not a discount', async () => {
    const svc = createVisitService(fake.repos);
    const first = await svc.create(base);
    const second = await svc.create({
      ...base,
      visitDate: '2026-05-06',
      therapistId: 'th-aish', // therapist may change mid-package
      isContinuation: true,
      sessionIndex: 2,
      packageTotal: 3,
      packageGroupId: first.packageGroupId,
    });
    expect(second.actualBillPaise).toBe(0);
    expect(second.adjustmentPaise).toBe(0);
    expect(second.bmSharePaise).toBe(0);
    expect(second.packageGroupId).toBe(first.packageGroupId);
  });

  it('freezes billing once a visit is invoiced', async () => {
    const svc = createVisitService(fake.repos);
    const v = await svc.create(base);
    fake.visits.set(v.id, { ...v, invoiceId: 'inv-1' });
    await expect(svc.updateBilling(v.id, { actualBillPaise: rs(100) })).rejects.toThrow(/frozen/);
  });

  it('recomputes splits with the ORIGINAL rate snapshot on edit', async () => {
    const svc = createVisitService(fake.repos);
    const v = await svc.create(base);
    // Simulate a later renegotiation by editing the visit after clinic rates
    // would have changed — the visit's own snapshot (75/10) must be used.
    const updated = await svc.updateBilling(v.id, {
      actualBillPaise: rs(2000),
      adjustmentReason: 'hardship case',
    });
    expect(updated.postTaxPaise).toBe(rs(1350)); // 2000 × 0.675
  });

  it('degenerates the split in simple (non-hospital) billing mode', async () => {
    const simpleFake = makeFakeRepos({ billingMode: 'simple' });
    const v = await createVisitService(simpleFake.repos).create(base);
    // Whole bill is the clinic's; no tax withheld; snapshots stored as 100/0.
    expect(v.bmSplitPct).toBe(100);
    expect(v.taxPct).toBe(0);
    expect(v.bmSharePaise).toBe(v.actualBillPaise);
    expect(v.postTaxPaise).toBe(v.actualBillPaise);
    expect(v.tdsPaise).toBe(0);
    expect(v.hvPaise).toBe(0);
  });
});

describe('reportService.monthly', () => {
  it('rolls up per therapist with unique patient counts', async () => {
    const fake = makeFakeRepos();
    const svc = createVisitService(fake.repos);
    const mk = (patientId: string, therapistId: string, bill: number, date = '2026-05-10') =>
      svc.create({
        clinicId: 'clinic-1',
        patientId,
        therapistId,
        visitDate: date,
        serviceCatalogId: 'svc-consult',
        actualBillPaise: rs(bill),
        adjustmentReason: bill !== 800 ? 'test variance' : undefined,
      });

    await mk('p1', 'th-prem', 800);
    await mk('p1', 'th-prem', 800, '2026-05-12'); // same patient, second visit
    await mk('p2', 'th-aish', 800);
    await mk('p3', 'th-prem', 800, '2026-06-01'); // next month — excluded

    const report = await createReportService(fake.repos).monthly('clinic-1', {
      year: 2026,
      month: 5,
    });
    expect(report.total.billPaise).toBe(rs(2400));
    expect(report.total.visitCount).toBe(3);
    expect(report.total.uniquePatients).toBe(2); // p1 counted once
    const prem = report.rows.find((r) => r.therapistName === 'Prem')!;
    expect(prem.billPaise).toBe(rs(1600));
    expect(prem.uniquePatients).toBe(1);
    expect(prem.postTaxPaise).toBe(rs(1080)); // 2 × 540
  });
});

describe('visitService.setSplit', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  const base = {
    clinicId: 'clinic-1',
    patientId: 'p1',
    therapistId: 'th-prem',
    visitDate: '2026-05-10',
    serviceCatalogId: 'svc-physio3',
  };

  it('stores an assisting therapist and share', async () => {
    const svc = createVisitService(fake.repos);
    const v = await svc.create(base);
    const updated = await svc.setSplit(v.id, { sharedTherapistId: 'th-aish', sharedPct: 33.33 });
    expect(updated.sharedTherapistId).toBe('th-aish');
    expect(updated.sharedPct).toBe(33.33);
  });

  it('rejects splitting with the same (primary) therapist', async () => {
    const svc = createVisitService(fake.repos);
    const v = await svc.create(base);
    await expect(svc.setSplit(v.id, { sharedTherapistId: 'th-prem', sharedPct: 50 })).rejects.toThrow(
      /different therapist/
    );
  });

  it('rejects an out-of-range percentage', async () => {
    const svc = createVisitService(fake.repos);
    const v = await svc.create(base);
    await expect(svc.setSplit(v.id, { sharedTherapistId: 'th-aish', sharedPct: 150 })).rejects.toThrow(
      /between 0 and 100/
    );
  });

  it('refuses to split a ₹0 continuation session', async () => {
    const svc = createVisitService(fake.repos);
    const first = await svc.create(base);
    const zero = await svc.create({
      ...base,
      visitDate: '2026-05-12',
      isContinuation: true,
      sessionIndex: 2,
      packageTotal: 3,
      packageGroupId: first.packageGroupId,
    });
    await expect(svc.setSplit(zero.id, { sharedTherapistId: 'th-aish', sharedPct: 50 })).rejects.toThrow(
      /no billed amount/
    );
  });

  it('clears both fields when the assistant is null', async () => {
    const svc = createVisitService(fake.repos);
    const v = await svc.create(base);
    await svc.setSplit(v.id, { sharedTherapistId: 'th-aish', sharedPct: 40 });
    const cleared = await svc.setSplit(v.id, { sharedTherapistId: null });
    expect(cleared.sharedTherapistId).toBeNull();
    expect(cleared.sharedPct).toBeNull();
  });

  it('allows setting a split on an already-invoiced visit', async () => {
    const svc = createVisitService(fake.repos);
    const v = await svc.create(base);
    fake.visits.set(v.id, { ...v, invoiceId: 'inv-1' });
    const updated = await svc.setSplit(v.id, { sharedTherapistId: 'th-aish', sharedPct: 25 });
    expect(updated.sharedTherapistId).toBe('th-aish');
  });
});

describe('patientService MRNO fallback', () => {
  it('uses the typed hospital MRNO when given, generates W- prefixed otherwise', async () => {
    const fake = makeFakeRepos();
    const svc = createPatientService(fake.repos);
    const hospital = await svc.create({ clinicId: 'clinic-1', mrno: 'HV12345', name: 'Asha' });
    expect(hospital.mrno).toBe('HV12345');
    expect(hospital.mrnoSource).toBe('hospital');

    const walkIn = await svc.create({ clinicId: 'clinic-1', name: 'Ravi' });
    expect(walkIn.mrno).toMatch(/^W-\d{6}-[A-Z0-9]{3}$/);
    expect(walkIn.mrnoSource).toBe('auto');

    await expect(svc.create({ clinicId: 'clinic-1', mrno: 'HV12345', name: 'Dup' })).rejects.toThrow(
      /already exists/
    );
  });
});
