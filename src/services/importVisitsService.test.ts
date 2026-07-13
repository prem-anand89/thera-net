import { beforeEach, describe, expect, it } from 'vitest';
import { createImportVisitsService } from './importVisitsService';
import type { Repos, VisitFilter } from '@/repositories/types';
import type { CatalogItem, Clinic, Patient, Therapist, Visit } from '@/domain/types';
import { rupeesToPaise as rs } from '@/domain/money';
import type { RawImportRow } from './import/xlsxReader';

// Same in-memory Repos double pattern as visitService.test.ts.
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
    { id: 'th-aish', clinicId: 'clinic-1', name: 'Aishwarya', active: true, updatedAt: '' },
  ];
  const catalog: CatalogItem[] = [
    {
      id: 'svc-manual',
      clinicId: 'clinic-1',
      category: 'Manual Therapy',
      name: 'Manual Therapy',
      sessionCount: 1,
      basePricePaise: rs(1500),
      active: true,
      updatedAt: '',
    },
    {
      id: 'svc-physio5',
      clinicId: 'clinic-1',
      category: 'Physiotherapy',
      name: 'Physiotherapy 5 Days',
      sessionCount: 5,
      basePricePaise: rs(3500),
      active: true,
      updatedAt: '',
    },
    {
      id: 'svc-advanced3',
      clinicId: 'clinic-1',
      category: 'Advanced Therapy',
      name: 'Advanced Therapy 3 Days',
      sessionCount: 3,
      basePricePaise: rs(5400),
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
        [...visits.values()].filter((v) => !v.deleted && v.clinicId === f.clinicId),
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
  return { repos, patients, visits };
}

function makeRow(overrides: Partial<RawImportRow> & { sheet: string; sheetRowIndex: number }): RawImportRow {
  return {
    dateRaw: new Date(2026, 3, 1),
    patientName: 'Test Patient',
    mrno: '10001',
    ageSex: '40/F',
    condition: 'Back pain',
    therapistName: 'Prem',
    treatmentNotes: 'Notes',
    serviceNameRaw: 'Manual Therapy',
    billAmountRupees: 1500,
    ...overrides,
  };
}

describe('importVisitsService.preview', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('resolves a clean single-session row with no blocking issues', async () => {
    const svc = createImportVisitsService(fake.repos);
    const preview = await svc.preview([makeRow({ sheet: 'April', sheetRowIndex: 0 })], 'clinic-1');
    expect(preview.rows).toHaveLength(1);
    const row = preview.rows[0];
    expect(row.blockingIssues).toEqual([]);
    expect(row.catalogItemId).toBe('svc-manual');
    expect(row.therapistId).toBe('th-prem');
    expect(row.visitDate).toBe('2026-04-01');
    expect(row.isPackage).toBe(false);
  });

  it('flags a bad date, an unknown therapist, and an unmatched service', async () => {
    const svc = createImportVisitsService(fake.repos);
    const preview = await svc.preview(
      [
        makeRow({ sheet: 'May', sheetRowIndex: 0, dateRaw: 0.4 }),
        makeRow({ sheet: 'May', sheetRowIndex: 1, therapistName: 'Unknown Person' }),
        makeRow({ sheet: 'May', sheetRowIndex: 2, serviceNameRaw: 'Exercise Therapy + KT' }),
      ],
      'clinic-1'
    );
    expect(preview.rows[0].blockingIssues).toContain('bad-date');
    expect(preview.rows[1].blockingIssues).toContain('unknown-therapist');
    expect(preview.rows[2].blockingIssues).toContain('unmatched-service');
    expect(preview.summary.flaggedRows).toBe(3);
  });

  it('groups a real 5-day package and picks the nonzero-bill row as anchor', async () => {
    const svc = createImportVisitsService(fake.repos);
    const rows: RawImportRow[] = [1, 2, 3, 4, 5].map((n) =>
      makeRow({
        sheet: 'May',
        sheetRowIndex: n - 1,
        dateRaw: new Date(2026, 4, n),
        serviceNameRaw: `Physio ${n}/5`,
        billAmountRupees: n === 2 ? 3500 : 0, // real data: billed on session 2, not 1
      })
    );
    const preview = await svc.preview(rows, 'clinic-1');
    expect(preview.rows.every((r) => r.blockingIssues.length === 0)).toBe(true);
    expect(preview.rows.every((r) => r.isPackage)).toBe(true);
    const groupIds = new Set(preview.rows.map((r) => r.packageGroupId));
    expect(groupIds.size).toBe(1);
    const anchor = preview.rows.find((r) => r.isAnchor)!;
    expect(anchor.raw.serviceNameRaw).toBe('Physio 2/5');
    expect(preview.summary.packagesDetected).toBe(1);
  });

  it('flags a package with no billed session as a package-anomaly', async () => {
    const svc = createImportVisitsService(fake.repos);
    const rows: RawImportRow[] = [1, 2, 3].map((n) =>
      makeRow({
        sheet: 'June',
        sheetRowIndex: n - 1,
        serviceNameRaw: `Physio ${n}/5`,
        billAmountRupees: 0,
      })
    );
    const preview = await svc.preview(rows, 'clinic-1');
    expect(preview.rows.every((r) => r.packageAnomaly === 'no-anchor')).toBe(true);
    expect(preview.rows.every((r) => r.blockingIssues.includes('package-anomaly'))).toBe(true);
  });

  it('surfaces the real "Advanced Therapy 2/2" mislabel as unmatched, not a new package size', async () => {
    const svc = createImportVisitsService(fake.repos);
    const preview = await svc.preview(
      [makeRow({ sheet: 'May', sheetRowIndex: 0, serviceNameRaw: 'Advanced Therapy 2/2', billAmountRupees: 3600 })],
      'clinic-1'
    );
    expect(preview.rows[0].blockingIssues).toContain('unmatched-service');
    expect(preview.rows[0].attemptedCatalogName).toBe('Advanced Therapy 2 Days');
  });

  it('flags ambiguous patient-name spelling without blocking the row', async () => {
    const svc = createImportVisitsService(fake.repos);
    const preview = await svc.preview(
      [
        makeRow({ sheet: 'April', sheetRowIndex: 0, patientName: 'Sindoora Unnam' }),
        makeRow({ sheet: 'April', sheetRowIndex: 1, patientName: 'Sindhoora Unnam' }),
      ],
      'clinic-1'
    );
    expect(preview.rows[0].patientNameAmbiguous).toBe(true);
    expect(preview.rows[0].blockingIssues).toEqual([]);
  });

  it('detects an MRNO that already has a patient record', async () => {
    fake.patients.set('pat-1', {
      id: 'pat-1',
      clinicId: 'clinic-1',
      mrno: '10001',
      mrnoSource: 'hospital',
      name: 'Test Patient',
      age: 40,
      sex: 'F',
      phone: null,
      primaryCondition: null,
      updatedAt: '',
    });
    const svc = createImportVisitsService(fake.repos);
    const preview = await svc.preview([makeRow({ sheet: 'April', sheetRowIndex: 0 })], 'clinic-1');
    expect(preview.rows[0].existingPatientId).toBe('pat-1');
    expect(preview.summary.newPatients).toBe(0);
  });
});

describe('importVisitsService.commit', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('creates a new patient and a visit whose split matches computeVisitSplit', async () => {
    const svc = createImportVisitsService(fake.repos);
    const preview = await svc.preview([makeRow({ sheet: 'April', sheetRowIndex: 0 })], 'clinic-1');
    const summary = await svc.commit(preview, {}, 'clinic-1');
    expect(summary.patientsCreated).toBe(1);
    expect(summary.visitsCreated).toBe(1);
    const visit = [...fake.visits.values()][0];
    expect(visit.actualBillPaise).toBe(rs(1500));
    expect(visit.bmSharePaise).toBe(rs(1125)); // 75% of 1500
    expect(visit.postTaxPaise).toBe(rs(1013)); // 1012.50 rounds half-up to the rupee
    expect(visit.adjustmentPaise).toBe(0);
  });

  it('reuses an existing patient by MRNO instead of creating a duplicate', async () => {
    fake.patients.set('pat-1', {
      id: 'pat-1',
      clinicId: 'clinic-1',
      mrno: '10001',
      mrnoSource: 'hospital',
      name: 'Test Patient',
      age: 40,
      sex: 'F',
      phone: null,
      primaryCondition: null,
      updatedAt: '',
    });
    const svc = createImportVisitsService(fake.repos);
    const preview = await svc.preview([makeRow({ sheet: 'April', sheetRowIndex: 0 })], 'clinic-1');
    const summary = await svc.commit(preview, {}, 'clinic-1');
    expect(summary.patientsCreated).toBe(0);
    expect(summary.patientsReused).toBe(1);
    expect([...fake.visits.values()][0].patientId).toBe('pat-1');
  });

  it('commits a package group as one billed anchor plus ₹0 continuations', async () => {
    const svc = createImportVisitsService(fake.repos);
    const rows: RawImportRow[] = [1, 2, 3, 4, 5].map((n) =>
      makeRow({
        sheet: 'May',
        sheetRowIndex: n - 1,
        dateRaw: new Date(2026, 4, n),
        serviceNameRaw: `Physio ${n}/5`,
        billAmountRupees: n === 2 ? 3500 : 0,
      })
    );
    const preview = await svc.preview(rows, 'clinic-1');
    await svc.commit(preview, {}, 'clinic-1');
    const visits = [...fake.visits.values()];
    expect(visits).toHaveLength(5);
    const groupIds = new Set(visits.map((v) => v.packageGroupId));
    expect(groupIds.size).toBe(1);
    const billed = visits.filter((v) => v.actualBillPaise > 0);
    expect(billed).toHaveLength(1);
    expect(billed[0].sessionIndex).toBe(2);
    expect(billed[0].bmSharePaise).toBe(rs(2625)); // 75% of 3500
    const zeroRows = visits.filter((v) => v.actualBillPaise === 0);
    expect(zeroRows).toHaveLength(4);
    expect(zeroRows.every((v) => v.bmSharePaise === 0)).toBe(true);
  });

  it('skips a row marked skip and excludes it from the summary counts', async () => {
    const svc = createImportVisitsService(fake.repos);
    const preview = await svc.preview(
      [
        makeRow({ sheet: 'April', sheetRowIndex: 0 }),
        makeRow({ sheet: 'April', sheetRowIndex: 1, mrno: '10002' }),
      ],
      'clinic-1'
    );
    const skipKey = preview.rows[1].key;
    const summary = await svc.commit(preview, { [skipKey]: { skip: true } }, 'clinic-1');
    expect(summary.visitsCreated).toBe(1);
    expect(summary.rowsSkipped).toBe(1);
  });

  it('throws when a blocking issue is left unresolved', async () => {
    const svc = createImportVisitsService(fake.repos);
    const preview = await svc.preview(
      [makeRow({ sheet: 'April', sheetRowIndex: 0, serviceNameRaw: 'Nonexistent Service' })],
      'clinic-1'
    );
    await expect(svc.commit(preview, {}, 'clinic-1')).rejects.toThrow(/unresolved issue/);
  });

  it('honors a manual catalog reassignment for an unmatched service', async () => {
    const svc = createImportVisitsService(fake.repos);
    const preview = await svc.preview(
      [makeRow({ sheet: 'April', sheetRowIndex: 0, serviceNameRaw: 'Advanced Therapy 2/2', billAmountRupees: 3600 })],
      'clinic-1'
    );
    const key = preview.rows[0].key;
    const summary = await svc.commit(
      preview,
      { [key]: { catalogItemId: 'svc-advanced3' } },
      'clinic-1'
    );
    expect(summary.visitsCreated).toBe(1);
    const visit = [...fake.visits.values()][0];
    expect(visit.serviceCatalogId).toBe('svc-advanced3');
    expect(visit.actualBillPaise).toBe(rs(3600));
    // 3600 != catalog price 5400 -> auto-filled adjustment reason
    expect(visit.adjustmentReason).toMatch(/Historical import/);
  });

  it('honors a manual date fix for the corrupted date row', async () => {
    const svc = createImportVisitsService(fake.repos);
    const preview = await svc.preview(
      [makeRow({ sheet: 'May', sheetRowIndex: 0, dateRaw: 0.4 })],
      'clinic-1'
    );
    const key = preview.rows[0].key;
    await svc.commit(preview, { [key]: { visitDate: '2026-05-15' } }, 'clinic-1');
    expect([...fake.visits.values()][0].visitDate).toBe('2026-05-15');
  });
});
