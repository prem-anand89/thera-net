import { beforeEach, describe, expect, it } from 'vitest';
import { createDashboardService } from './dashboardService';
import type { Repos, VisitFilter } from '@/repositories/types';
import type { CatalogItem, Clinic, Invoice, InvoicePayment, Payment, Patient, Therapist, Visit } from '@/domain/types';
import { rupeesToPaise as rs } from '@/domain/money';

function makeFakeRepos() {
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
  };
  const therapists: Therapist[] = [
    { id: 'th-prem', clinicId: 'clinic-1', name: 'Prem', active: true, updatedAt: '' },
  ];
  const catalog: CatalogItem[] = [
    {
      id: 'svc-1',
      clinicId: 'clinic-1',
      category: 'Manual Therapy',
      name: 'Manual Therapy',
      sessionCount: 1,
      basePricePaise: rs(1500),
      active: true,
      updatedAt: '',
    },
  ];
  const patients = new Map<string, Patient>([
    [
      'pat-1',
      {
        id: 'pat-1',
        clinicId: 'clinic-1',
        mrno: '1001',
        mrnoSource: 'hospital',
        name: 'Test Patient',
        age: 40,
        sex: 'F',
        phone: null,
        primaryCondition: null,
        updatedAt: '',
      },
    ],
  ]);
  const visits = new Map<string, Visit>();
  const invoices = new Map<string, Invoice>();
  const invoicePayments = new Map<string, InvoicePayment>();
  const payments = new Map<string, Payment>();

  const repos: Repos = {
    clinics: { get: async (id) => (id === clinic.id ? clinic : undefined), list: async () => [clinic], put: async () => {} },
    therapists: { list: async () => therapists, put: async () => {} },
    catalog: { list: async () => catalog, get: async (id) => catalog.find((c) => c.id === id), put: async () => {} },
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
          (v) => !v.deleted && v.clinicId === f.clinicId && (!f.from || v.visitDate >= f.from)
        ),
      listByIds: async (ids) => ids.map((id) => visits.get(id)!).filter(Boolean),
      listByPackageGroup: async (gid) => [...visits.values()].filter((v) => v.packageGroupId === gid && !v.deleted),
      put: async (v) => void visits.set(v.id, v),
      softDelete: async (id) => {
        const v = visits.get(id);
        if (v) visits.set(id, { ...v, deleted: true });
      },
      markInvoiced: async () => {},
    },
    invoices: {
      get: async (id) => invoices.get(id),
      list: async (clinicId) => [...invoices.values()].filter((i) => i.clinicId === clinicId),
      putLocal: async (inv) => void invoices.set(inv.id, inv),
    },
    invoicePayments: {
      getByInvoiceId: async (invoiceId) => [...invoicePayments.values()].find((p) => p.invoiceId === invoiceId),
      list: async (clinicId) => [...invoicePayments.values()].filter((p) => p.clinicId === clinicId),
      put: async (p) => void invoicePayments.set(p.id, p),
    },
    payments: {
      get: async (id) => payments.get(id),
      list: async (clinicId) => [...payments.values()].filter((p) => p.clinicId === clinicId),
      listByDate: async (clinicId, date) =>
        [...payments.values()].filter((p) => p.clinicId === clinicId && p.receivedDate === date),
      listByVisit: async (visitId) => [...payments.values()].filter((p) => p.visitId === visitId),
      put: async (p) => void payments.set(p.id, p),
      delete: async (id) => void payments.delete(id),
    },
    settlements: {
      getByPeriod: async () => undefined,
      list: async () => [],
      put: async () => {},
    },
    consultationNotes: { get: async () => undefined, list: async () => [], put: async () => {} },
  };
  return { repos, visits, invoices, invoicePayments, payments, patients };
}

const baseVisit = (id: string, overrides: Partial<Visit>): Visit => ({
  id,
  clinicId: 'clinic-1',
  patientId: 'pat-1',
  therapistId: 'th-prem',
  visitDate: '2026-06-01',
  condition: null,
  treatmentNotes: null,
  serviceCatalogId: 'svc-1',
  catalogPricePaise: rs(1500),
  actualBillPaise: rs(1500),
  adjustmentPaise: 0,
  adjustmentReason: null,
  sessionIndex: null,
  packageTotal: null,
  packageGroupId: null,
  bmSplitPct: 75,
  taxPct: 10,
  tdsBasis: 'gross_bill',
  bmSharePaise: rs(1125),
  postTaxPaise: rs(1013),
  tdsPaise: rs(150),
  hvPaise: rs(487),
  invoiceId: null,
  deleted: false,
  updatedAt: '',
  ...overrides,
});

const baseInvoice = (id: string, overrides: Partial<Invoice>): Invoice => ({
  id,
  clinicId: 'clinic-1',
  invoiceNo: `BM/26-27/000${id}`,
  fyLabel: '26-27',
  seq: 1,
  issuedAt: '2026-06-01T00:00:00Z',
  patientSnapshot: { mrno: '1001', name: 'Test Patient', age: 40, sex: 'F' },
  lineItems: [],
  totalPaise: rs(1500),
  paymentMode: 'Cash',
  therapistId: 'th-prem',
  updatedAt: '',
  ...overrides,
});

describe('dashboardService.revenueTrend', () => {
  it('returns 6 months in chronological order ending at the reference month', async () => {
    const fake = makeFakeRepos();
    const svc = createDashboardService(fake.repos);
    const trend = await svc.revenueTrend('clinic-1', 6);
    expect(trend).toHaveLength(6);
    for (let i = 1; i < trend.length; i++) {
      const prev = trend[i - 1].month;
      const cur = trend[i].month;
      const prevIndex = prev.year * 12 + prev.month;
      const curIndex = cur.year * 12 + cur.month;
      expect(curIndex).toBe(prevIndex + 1);
    }
  });
});

describe('dashboardService.openPackages', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('attaches patient/service names and computes staleness', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: '2026-06-01', packageGroupId: 'g1', packageTotal: 3 }));
    const svc = createDashboardService(fake.repos);
    const rows = await svc.openPackages('clinic-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      patientId: 'pat-1',
      patientName: 'Test Patient',
      mrno: '1001',
      serviceName: 'Manual Therapy',
      sessionsLogged: 1,
      packageTotal: 3,
    });
  });

  it('excludes a completed package', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: '2026-06-01', packageGroupId: 'g1', packageTotal: 1 }));
    const svc = createDashboardService(fake.repos);
    expect(await svc.openPackages('clinic-1')).toEqual([]);
  });

  it('counts sessions across all history, not a recent window', async () => {
    // Regression: a package whose earlier sessions are older than any
    // "recent months" cutoff must still count them — 3 of 3 logged means
    // NOT open, even if two sessions are a year old.
    fake.visits.set('v1', baseVisit('v1', { visitDate: '2025-01-05', packageGroupId: 'g1', packageTotal: 3 }));
    fake.visits.set('v2', baseVisit('v2', { visitDate: '2025-01-12', packageGroupId: 'g1', packageTotal: 3 }));
    fake.visits.set('v3', baseVisit('v3', { visitDate: '2026-06-20', packageGroupId: 'g1', packageTotal: 3 }));
    const svc = createDashboardService(fake.repos);
    expect(await svc.openPackages('clinic-1')).toEqual([]);
  });
});

describe('dashboardService.outstandingInvoices', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('treats an invoice with no payment row as paid, not outstanding', async () => {
    fake.invoices.set('inv-1', baseInvoice('inv-1', {}));
    const svc = createDashboardService(fake.repos);
    const summary = await svc.outstandingInvoices('clinic-1');
    expect(summary.rows).toEqual([]);
    expect(summary.totalPaise).toBe(0);
  });

  it('includes only invoices with an explicit outstanding payment row', async () => {
    fake.invoices.set('inv-1', baseInvoice('inv-1', { totalPaise: rs(1500) }));
    fake.invoices.set('inv-2', baseInvoice('inv-2', { totalPaise: rs(2000) }));
    fake.invoicePayments.set('p1', {
      id: 'p1',
      clinicId: 'clinic-1',
      invoiceId: 'inv-1',
      status: 'outstanding',
      paidAt: null,
      updatedAt: '',
    });
    fake.invoicePayments.set('p2', {
      id: 'p2',
      clinicId: 'clinic-1',
      invoiceId: 'inv-2',
      status: 'paid',
      paidAt: '2026-06-02T00:00:00Z',
      updatedAt: '',
    });
    const svc = createDashboardService(fake.repos);
    const summary = await svc.outstandingInvoices('clinic-1');
    expect(summary.count).toBe(1);
    expect(summary.rows[0].invoiceId).toBe('inv-1');
    expect(summary.totalPaise).toBe(rs(1500));
  });
});

describe('dashboardService.pendingWork', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('flags a stale open package', async () => {
    fake.visits.set(
      'v1',
      baseVisit('v1', {
        visitDate: '2026-01-01',
        packageGroupId: 'pkg-1',
        packageTotal: 5,
        sessionIndex: 1,
      })
    );
    // Paid, so this only exercises the stale-package signal, not the
    // separate (and independently tested) outstanding-payment one.
    fake.payments.set('pay-1', {
      id: 'pay-1',
      clinicId: 'clinic-1',
      visitId: 'v1',
      amountPaise: rs(1500),
      method: 'cash',
      receivedDate: '2026-01-01',
      notes: null,
      updatedAt: '',
    });
    const svc = createDashboardService(fake.repos);
    const items = await svc.pendingWork('clinic-1');
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('stale_package');
    expect(items[0].patientName).toBe('Test Patient');
  });

  it('flags an invoice explicitly marked outstanding', async () => {
    fake.invoices.set('inv-1', baseInvoice('inv-1', { totalPaise: rs(1500) }));
    fake.invoicePayments.set('p1', {
      id: 'p1',
      clinicId: 'clinic-1',
      invoiceId: 'inv-1',
      status: 'outstanding',
      paidAt: null,
      updatedAt: '',
    });
    const svc = createDashboardService(fake.repos);
    const items = await svc.pendingWork('clinic-1');
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('outstanding_payment');
    expect(items[0].amountPaise).toBe(rs(1500));
  });

  it('flags a billed visit with no invoice and no direct payment, carrying the pending note', async () => {
    fake.visits.set('v1', baseVisit('v1', { pendingPaymentNote: 'Will pay next Monday' }));
    const svc = createDashboardService(fake.repos);
    const items = await svc.pendingWork('clinic-1');
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('outstanding_payment');
    expect(items[0].detail).toBe('Marked pending: Will pay next Monday');
  });

  it('does not flag a billed visit once a direct payment is logged against it', async () => {
    fake.visits.set('v1', baseVisit('v1', {}));
    fake.payments.set('pay-1', {
      id: 'pay-1',
      clinicId: 'clinic-1',
      visitId: 'v1',
      amountPaise: rs(1500),
      method: 'cash',
      receivedDate: '2026-06-01',
      notes: null,
      updatedAt: '',
    });
    const svc = createDashboardService(fake.repos);
    expect(await svc.pendingWork('clinic-1')).toHaveLength(0);
  });

  it('does not flag a zero-bill continuation session as an outstanding payment', async () => {
    fake.visits.set('v1', baseVisit('v1', { actualBillPaise: 0, catalogPricePaise: 0 }));
    const svc = createDashboardService(fake.repos);
    expect(await svc.pendingWork('clinic-1')).toHaveLength(0);
  });

  it('flags a visit whose clinical note was never finished', async () => {
    fake.visits.set('v1', baseVisit('v1', { clinicalStatus: 'pending', invoiceId: null }));
    fake.payments.set('pay-1', {
      id: 'pay-1',
      clinicId: 'clinic-1',
      visitId: 'v1',
      amountPaise: rs(1500),
      method: 'cash',
      receivedDate: '2026-06-01',
      notes: null,
      updatedAt: '',
    });
    const svc = createDashboardService(fake.repos);
    const items = await svc.pendingWork('clinic-1');
    // Paid, so no outstanding_payment item — only the incomplete note remains.
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('incomplete_note');
  });

  it('sorts all items most-overdue-first', async () => {
    fake.invoices.set('inv-1', baseInvoice('inv-1', { issuedAt: '2026-06-10T00:00:00Z' }));
    fake.invoicePayments.set('p1', {
      id: 'p1',
      clinicId: 'clinic-1',
      invoiceId: 'inv-1',
      status: 'outstanding',
      paidAt: null,
      updatedAt: '',
    });
    fake.visits.set('v1', baseVisit('v1', { visitDate: '2026-01-01' }));
    const svc = createDashboardService(fake.repos);
    const items = await svc.pendingWork('clinic-1');
    expect(items[0].visitId).toBe('v1'); // the older unpaid visit sorts before the newer invoice
  });
});

describe('dashboardService.recentVisits', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('returns most recent visits first, with names attached', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: '2026-06-01' }));
    fake.visits.set('v2', baseVisit('v2', { visitDate: '2026-06-10' }));
    const svc = createDashboardService(fake.repos);
    const rows = await svc.recentVisits('clinic-1');
    expect(rows.map((r) => r.visitId)).toEqual(['v2', 'v1']);
    expect(rows[0]).toMatchObject({
      patientName: 'Test Patient',
      mrno: '1001',
      therapistName: 'Prem',
      serviceName: 'Manual Therapy',
      hasInvoice: false,
    });
  });

  it('respects the limit', async () => {
    for (let i = 0; i < 5; i++) {
      fake.visits.set(`v${i}`, baseVisit(`v${i}`, { visitDate: `2026-06-0${i + 1}` }));
    }
    const svc = createDashboardService(fake.repos);
    expect(await svc.recentVisits('clinic-1', 3)).toHaveLength(3);
  });

  it('flags invoiced visits', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: '2026-06-01', invoiceId: 'inv-1' }));
    const svc = createDashboardService(fake.repos);
    expect((await svc.recentVisits('clinic-1'))[0].hasInvoice).toBe(true);
  });

  it('carries treatment notes through', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: '2026-06-01', treatmentNotes: 'Ultrasound + stretch' }));
    const svc = createDashboardService(fake.repos);
    expect((await svc.recentVisits('clinic-1'))[0].treatmentNotes).toBe('Ultrasound + stretch');
  });
});

describe('dashboardService.recentVisitsWindow', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });
  const asOf = new Date('2026-06-15T00:00:00Z');

  it('includes visits inside the window and excludes visits outside it', async () => {
    fake.visits.set('in-window', baseVisit('in-window', { visitDate: '2026-06-10' }));
    fake.visits.set('too-old', baseVisit('too-old', { visitDate: '2026-05-01' }));
    const svc = createDashboardService(fake.repos);
    const rows = await svc.recentVisitsWindow('clinic-1', 7, asOf);
    expect(rows.map((r) => r.visitId)).toEqual(['in-window']);
  });

  it('returns every matching visit, not a capped preview', async () => {
    for (let i = 0; i < 10; i++) {
      fake.visits.set(`v${i}`, baseVisit(`v${i}`, { visitDate: `2026-06-${String(i + 1).padStart(2, '0')}` }));
    }
    const svc = createDashboardService(fake.repos);
    expect(await svc.recentVisitsWindow('clinic-1', 30, asOf)).toHaveLength(10);
  });

  it('widening the window from 7 to 30 days includes older visits', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: '2026-05-20' }));
    const svc = createDashboardService(fake.repos);
    expect(await svc.recentVisitsWindow('clinic-1', 7, asOf)).toHaveLength(0);
    expect(await svc.recentVisitsWindow('clinic-1', 30, asOf)).toHaveLength(1);
  });

  it('excludes visits dated today, so Recent continues after the Today list without overlap', async () => {
    fake.visits.set('yesterday', baseVisit('yesterday', { visitDate: '2026-06-14' }));
    fake.visits.set('today', baseVisit('today', { visitDate: '2026-06-15' }));
    const svc = createDashboardService(fake.repos);
    const rows = await svc.recentVisitsWindow('clinic-1', 7, asOf);
    expect(rows.map((r) => r.visitId)).toEqual(['yesterday']);
  });
});

describe('dashboardService.singleVisitPatients', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('flags a patient with exactly one old visit', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: '2020-01-01' }));
    const svc = createDashboardService(fake.repos);
    const rows = await svc.singleVisitPatients('clinic-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ patientName: 'Test Patient', mrno: '1001', serviceName: 'Manual Therapy' });
  });

  it('excludes a single visit still inside the grace window', async () => {
    const today = new Date().toISOString().slice(0, 10);
    fake.visits.set('v1', baseVisit('v1', { visitDate: today }));
    const svc = createDashboardService(fake.repos);
    expect(await svc.singleVisitPatients('clinic-1')).toEqual([]);
  });

  it('excludes a patient with more than one visit', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: '2020-01-01' }));
    fake.visits.set('v2', baseVisit('v2', { visitDate: '2020-02-01' }));
    const svc = createDashboardService(fake.repos);
    expect(await svc.singleVisitPatients('clinic-1')).toEqual([]);
  });
});

describe('dashboardService.recurringPatients', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('surfaces a patient with 3+ visits in the last 30 days', async () => {
    const today = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * 5);
      fake.visits.set(`v${i}`, baseVisit(`v${i}`, { visitDate: d.toISOString().slice(0, 10) }));
    }
    const svc = createDashboardService(fake.repos);
    const rows = await svc.recurringPatients('clinic-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ patientName: 'Test Patient', mrno: '1001', visitCount: 3 });
  });

  it('excludes a patient under the minimum visit count', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: new Date().toISOString().slice(0, 10) }));
    const svc = createDashboardService(fake.repos);
    expect(await svc.recurringPatients('clinic-1')).toEqual([]);
  });

  it('ignores visits outside the rolling window', async () => {
    for (let i = 0; i < 3; i++) {
      fake.visits.set(`v${i}`, baseVisit(`v${i}`, { visitDate: '2020-01-0' + (i + 1) }));
    }
    const svc = createDashboardService(fake.repos);
    expect(await svc.recurringPatients('clinic-1')).toEqual([]);
  });
});

describe('dashboardService.weeklySummary', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('counts this Mon–Sun week and collects only paid visits by visit date', async () => {
    const asOf = new Date(2026, 5, 10); // Wed 10 Jun 2026 (local)
    const inWeek = '2026-06-10';
    // Invoiced with no explicit payment row → reads as paid → counts as collected.
    fake.visits.set('v1', baseVisit('v1', { visitDate: inWeek, postTaxPaise: rs(3645), invoiceId: 'inv-1' }));
    // Invoiced but outstanding → a visit this week, but NOT collected.
    fake.visits.set('v2', baseVisit('v2', { visitDate: inWeek, postTaxPaise: rs(1000), invoiceId: 'inv-2' }));
    fake.invoicePayments.set('p2', {
      id: 'p2',
      clinicId: 'clinic-1',
      invoiceId: 'inv-2',
      status: 'outstanding',
      paidAt: null,
      updatedAt: '',
    });
    // Not invoiced yet → not collected.
    fake.visits.set('v3', baseVisit('v3', { visitDate: inWeek, postTaxPaise: rs(500) }));
    // A different (earlier) week → excluded entirely.
    fake.visits.set('v4', baseVisit('v4', { visitDate: '2026-05-20', postTaxPaise: rs(999), invoiceId: 'inv-4' }));
    const summary = await createDashboardService(fake.repos).weeklySummary('clinic-1', asOf);
    expect(summary.visitCount).toBe(3);
    expect(summary.collectedPaise).toBe(rs(3645));
  });
});

describe('dashboardService.todayWorklist', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  const today = new Date(2026, 5, 10); // Wed 10 Jun 2026 (local)
  const todayStr = '2026-06-10';
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('only includes visits on the given date', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: todayStr }));
    fake.visits.set('v2', baseVisit('v2', { visitDate: '2026-06-09' }));
    const svc = createDashboardService(fake.repos);
    const result = await svc.todayWorklist('clinic-1', today);
    expect(result.visitCount).toBe(1);
    expect(result.visits[0].visitId).toBe('v1');
  });

  it('marks a zero-bill continuation session as zero_session regardless of invoice', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: todayStr, actualBillPaise: 0 }));
    const svc = createDashboardService(fake.repos);
    const result = await svc.todayWorklist('clinic-1', today);
    expect(result.visits[0].paymentState).toBe('zero_session');
  });

  it('marks a billable visit with no invoice as uninvoiced and counts it outstanding', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: todayStr, actualBillPaise: rs(1500) }));
    const svc = createDashboardService(fake.repos);
    const result = await svc.todayWorklist('clinic-1', today);
    expect(result.visits[0].paymentState).toBe('uninvoiced');
    expect(result.outstandingPaise).toBe(rs(1500));
    expect(result.collectedPaise).toBe(0);
  });

  it('marks an invoiced visit with no payment row as paid (default-paid convention)', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: todayStr, actualBillPaise: rs(1500), invoiceId: 'inv-1' }));
    const svc = createDashboardService(fake.repos);
    const result = await svc.todayWorklist('clinic-1', today);
    expect(result.visits[0].paymentState).toBe('paid');
    expect(result.collectedPaise).toBe(rs(1500));
  });

  it('marks an invoiced visit with an explicit outstanding row as outstanding', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: todayStr, actualBillPaise: rs(2000), invoiceId: 'inv-1' }));
    fake.invoicePayments.set('p1', {
      id: 'p1',
      clinicId: 'clinic-1',
      invoiceId: 'inv-1',
      status: 'outstanding',
      paidAt: null,
      updatedAt: '',
    });
    const svc = createDashboardService(fake.repos);
    const result = await svc.todayWorklist('clinic-1', today);
    expect(result.visits[0].paymentState).toBe('outstanding');
    expect(result.outstandingPaise).toBe(rs(2000));
  });

  it('attaches patient/therapist/service names and sorts by patient name', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: todayStr, condition: 'Shoulder pain' }));
    const svc = createDashboardService(fake.repos);
    const result = await svc.todayWorklist('clinic-1', today);
    expect(result.visits[0]).toMatchObject({
      patientName: 'Test Patient',
      mrno: '1001',
      condition: 'Shoulder pain',
      therapistName: 'Prem',
      serviceName: 'Manual Therapy',
    });
  });
});

describe('dashboardService.monthlyNewCounts', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('counts a package as new when its first session is this month', async () => {
    fake.visits.set(
      'v1',
      baseVisit('v1', { visitDate: '2026-06-05', packageGroupId: 'g1', packageTotal: 3 })
    );
    const svc = createDashboardService(fake.repos);
    const counts = await svc.monthlyNewCounts('clinic-1', new Date('2026-06-15'));
    expect(counts.newPackages).toBe(1);
  });

  it('does not count a package whose first session was an earlier month', async () => {
    fake.visits.set(
      'v1',
      baseVisit('v1', { visitDate: '2026-05-05', packageGroupId: 'g1', packageTotal: 3 })
    );
    fake.visits.set(
      'v2',
      baseVisit('v2', { visitDate: '2026-06-05', packageGroupId: 'g1', packageTotal: 3 })
    );
    const svc = createDashboardService(fake.repos);
    const counts = await svc.monthlyNewCounts('clinic-1', new Date('2026-06-15'));
    expect(counts.newPackages).toBe(0);
  });

  it('counts a patient as new when their first-ever visit is this month', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: '2026-06-05' }));
    const svc = createDashboardService(fake.repos);
    const counts = await svc.monthlyNewCounts('clinic-1', new Date('2026-06-15'));
    expect(counts.newPatients).toBe(1);
  });

  it('does not count a returning patient whose first visit was an earlier month', async () => {
    fake.visits.set('v1', baseVisit('v1', { visitDate: '2026-05-20' }));
    fake.visits.set('v2', baseVisit('v2', { visitDate: '2026-06-05' }));
    const svc = createDashboardService(fake.repos);
    const counts = await svc.monthlyNewCounts('clinic-1', new Date('2026-06-15'));
    expect(counts.newPatients).toBe(0);
  });
});
