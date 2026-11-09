// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

globalThis.IntersectionObserver = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})) as unknown as typeof IntersectionObserver;
import type { Department } from '@/domain/departments';
import { createReportService } from '@/services/reportService';
import { createDashboardService } from '@/services/dashboardService';
import type { Repos, VisitFilter } from '@/repositories/types';
import type { Therapist, Visit, VisitCredit, VisitItem } from '@/domain/types';

const CLINIC_ID = 'c1';
const TH1 = 'th-1';

let currentDept: Department = 'clinic';
vi.mock('@/app/DepartmentContext', () => ({
  useDepartment: () => ({
    department: currentDept,
    departments: ['clinic', 'home', 'ward'] as Department[],
    canSwitch: true,
    setDepartment: (d: Department) => {
      currentDept = d;
    },
  }),
}));

const mockClinic = {
  id: CLINIC_ID,
  name: 'Ortho Physio',
  invoicePrefix: 'BM',
  careLocations: ['clinic', 'home', 'ward'],
  slotDurationMinutes: 30,
  fyStartMonth: 4,
};

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => mockClinic,
}));

vi.mock('@/app/useWorkspaceScope', () => ({
  useWorkspaceScope: () => ({
    isAdmin: true,
    isFrontDesk: false,
    myTherapistId: TH1,
    isClinicWideView: true,
    scopeTherapistId: null,
  }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to?: string }) => <a href={to ?? '#'}>{children}</a>,
    useNavigate: () => vi.fn(),
    useSearch: () => ({ period: 'ytd', year: 2026, month: 11 }),
  };
});

function makeFakeRepos(visitList: Visit[]) {
  const ofVisits = <T extends { visitId: string; deleted: boolean }>(rows: T[] = []) => ({
    calls: 0,
    async listByVisitIds(ids: string[]) {
      return rows.filter((r) => ids.includes(r.visitId) && !r.deleted);
    },
  });
  const therapists: Therapist[] = [
    { id: TH1, clinicId: CLINIC_ID, name: 'Dr. Anita', active: true, updatedAt: '' },
  ];
  const repos = {
    therapists: { list: async () => therapists },
    visits: {
      list: async (f: VisitFilter) =>
        visitList.filter((v) => v.clinicId === f.clinicId && (!f.from || v.visitDate >= f.from) && (!f.to || v.visitDate <= f.to)),
      listByPackageGroup: async (groupId: string) =>
        visitList.filter((v) => v.packageGroupId === groupId && !v.deleted),
    },
    patients: { list: async () => [{ id: 'p1', clinicId: CLINIC_ID, name: 'Ananya', mrno: '001', deleted: false }] },
    catalog: { list: async () => [{ id: 's1', name: 'Physiotherapy' }] },
    noReturnReasonCatalog: { list: async () => [] },
    referringSourceCatalog: { list: async () => [] },
    consultationNotes: { listByClinic: async () => [] },
    invoicePayments: { list: async () => [] },
    payments: { list: async () => [] },
    clinicClosedDates: { listByClinic: async () => [] },
    visitItems: ofVisits<VisitItem>([]),
    visitCredits: ofVisits<VisitCredit>([]),
    clinics: { get: async () => ({ id: CLINIC_ID, careLocations: ['clinic', 'home', 'ward'], enableTherapistSplit: false }) },
  } as unknown as Repos;
  return repos;
}

const mockVisits: Visit[] = [
  {
    id: 'v-op-1',
    clinicId: CLINIC_ID,
    patientId: 'p1',
    therapistId: TH1,
    serviceCatalogId: 's1',
    visitDate: '2026-11-05',
    actualBillPaise: 50000,
    clinicSharePaise: 50000,
    tdsPaise: 0,
    postTaxPaise: 50000,
    partnerSharePaise: 0,
    adjustmentPaise: 0,
    adjustmentReason: null,
    location: 'clinic',
    condition: null,
    treatmentNotes: null,
    catalogPricePaise: 50000,
    sessionIndex: null,
    packageTotal: null,
    packageGroupId: null,
    clinicSplitPct: 100,
    taxPct: 0,
    tdsBasis: 'clinic_share' as const,
    invoiceId: null,
    sharedPct: null,
    sharedTherapistId: null,
    deleted: false,
    updatedAt: '2026-11-05T08:00:00Z',
  },
  {
    id: 'v-home-1',
    clinicId: CLINIC_ID,
    patientId: 'p1',
    therapistId: TH1,
    serviceCatalogId: 's1',
    visitDate: '2026-11-06',
    actualBillPaise: 80000,
    clinicSharePaise: 80000,
    tdsPaise: 0,
    postTaxPaise: 80000,
    partnerSharePaise: 0,
    adjustmentPaise: 0,
    adjustmentReason: null,
    location: 'home',
    condition: null,
    treatmentNotes: null,
    catalogPricePaise: 80000,
    sessionIndex: null,
    packageTotal: null,
    packageGroupId: null,
    clinicSplitPct: 100,
    taxPct: 0,
    tdsBasis: 'clinic_share' as const,
    invoiceId: null,
    sharedPct: null,
    sharedTherapistId: null,
    deleted: false,
    updatedAt: '2026-11-06T08:00:00Z',
  },
  {
    id: 'v-ward-1',
    clinicId: CLINIC_ID,
    patientId: 'p1',
    therapistId: TH1,
    serviceCatalogId: 's1',
    visitDate: '2026-11-07',
    actualBillPaise: 120000,
    clinicSharePaise: 120000,
    tdsPaise: 0,
    postTaxPaise: 120000,
    partnerSharePaise: 0,
    adjustmentPaise: 0,
    adjustmentReason: null,
    location: 'ward',
    condition: null,
    treatmentNotes: null,
    catalogPricePaise: 120000,
    sessionIndex: null,
    packageTotal: null,
    packageGroupId: null,
    clinicSplitPct: 100,
    taxPct: 0,
    tdsBasis: 'clinic_share' as const,
    invoiceId: null,
    sharedPct: null,
    sharedTherapistId: null,
    deleted: false,
    updatedAt: '2026-11-07T08:00:00Z',
  },
];

vi.mock('@/components/ClinicUtilisationCard', () => ({
  ClinicUtilisationCard: () => <div data-testid="clinic-utilisation-card" />,
}));

vi.mock('@/components/TherapistComparisonCard', () => ({
  TherapistComparisonCard: () => <div data-testid="therapist-comparison-card" />,
}));

const mockMonthlyReport = (billPaise: number) => ({
  month: { year: 2026, month: 11 },
  title: 'November 2026',
  rows: [
    {
      therapistId: TH1,
      therapistName: 'Dr. Anita',
      billPaise,
      clinicSharePaise: billPaise,
      tdsPaise: 0,
      postTaxPaise: billPaise,
      partnerSharePaise: 0,
      adjustmentPaise: 0,
      sharedPaise: 0,
      netClinicSharePaise: billPaise,
      netPostTaxPaise: billPaise,
      visitCount: 1,
      patientsTreated: 1,
      assistedVisitCount: 0,
      billedSessionCount: 1,
      uniquePatients: 1,
    },
  ],
  total: {
    therapistId: 'total' as const,
    therapistName: 'Total',
    billPaise,
    clinicSharePaise: billPaise,
    tdsPaise: 0,
    postTaxPaise: billPaise,
    partnerSharePaise: 0,
    adjustmentPaise: 0,
    sharedPaise: 0,
    netClinicSharePaise: billPaise,
    netPostTaxPaise: billPaise,
    visitCount: 1,
    patientsTreated: 1,
    assistedVisitCount: 0,
    billedSessionCount: 1,
    uniquePatients: 1,
  },
});

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn: () => unknown) => fn(),
}));

vi.mock('@/services', () => ({
  repos: {
    noReturnReasonCatalog: { list: () => [] },
    patients: { get: () => undefined },
    therapists: { list: () => [{ id: TH1, name: 'Dr. Anita', active: true }] },
  },
  dashboardService: {
    revenueTrend: (_cid: string, _months: unknown, dept?: Department) => [
      mockMonthlyReport(dept === 'home' ? 80000 : dept === 'ward' ? 120000 : 50000),
    ],
    singleVisitPatients: () => [],
    referralSourceStats: () => [],
    modalityUsage: () => [],
    repeatVisits: () => ({ repeatCount: 0, totalVisits: 1, ratePct: 0 }),
    monthlyNewCounts: () => ({ newPackages: 0, newPatients: 1 }),
  },
  reportService: {
    totalsForRange: (_cid: string, _from: string, _to: string, dept?: Department) =>
      mockMonthlyReport(dept === 'home' ? 80000 : dept === 'ward' ? 120000 : 50000),
    monthly: (_cid: string, _m: { year: number; month: number }, dept?: Department) =>
      mockMonthlyReport(dept === 'home' ? 80000 : dept === 'ward' ? 120000 : 50000),
  },
}));

import { ReportsOverviewPage } from './ReportsOverviewPage';

describe('Reports department scoping (G8)', () => {
  beforeEach(() => {
    currentDept = 'clinic';
  });

  afterEach(cleanup);

  it('reportService.monthly totals equal exactly the department visits', async () => {
    const repos = makeFakeRepos(mockVisits);
    const reportService = createReportService(repos);

    const month = { year: 2026, month: 11 };

    // OP report
    const opReport = await reportService.monthly(CLINIC_ID, month, 'clinic');
    expect(opReport.total.visitCount).toBe(1);
    expect(opReport.total.billPaise).toBe(50000);

    // Home care report
    const homeReport = await reportService.monthly(CLINIC_ID, month, 'home');
    expect(homeReport.total.visitCount).toBe(1);
    expect(homeReport.total.billPaise).toBe(80000);

    // IP report
    const wardReport = await reportService.monthly(CLINIC_ID, month, 'ward');
    expect(wardReport.total.visitCount).toBe(1);
    expect(wardReport.total.billPaise).toBe(120000);
  });

  it('dashboardService.revenueTrend and monthlyCollection scope strictly to the department', async () => {
    const repos = makeFakeRepos(mockVisits);
    const dashboardService = createDashboardService(repos);

    const month = { year: 2026, month: 11 };

    // Revenue trend in OP
    const opTrend = await dashboardService.revenueTrend(CLINIC_ID, [month], 'clinic');
    expect(opTrend[0].total.visitCount).toBe(1);
    expect(opTrend[0].total.billPaise).toBe(50000);

    // Revenue trend in Home care
    const homeTrend = await dashboardService.revenueTrend(CLINIC_ID, [month], 'home');
    expect(homeTrend[0].total.visitCount).toBe(1);
    expect(homeTrend[0].total.billPaise).toBe(80000);

    // Monthly collection in IP
    const wardCollection = await dashboardService.monthlyCollection(CLINIC_ID, month, undefined, 'ward');
    expect(wardCollection.billedPaise).toBe(120000);
  });

  it('ReportsOverviewPage scopes to active department and CareLocationSplitCard is deleted', () => {
    currentDept = 'clinic';
    render(<ReportsOverviewPage />);

    // CareLocationSplitCard is removed entirely from the DOM
    expect(screen.queryByText(/Care location split/i)).toBeNull();
    expect(screen.queryByText(/By place/i)).toBeNull();

    // In OP, Revenue card reflects the OP visit (₹500)
    expect(screen.getAllByText('₹500').length).toBeGreaterThanOrEqual(1);
    // Ward (₹1,200) and Home (₹800) are not shown
    expect(screen.queryByText('₹1,200')).toBeNull();
    expect(screen.queryByText('₹2,500')).toBeNull();
  });
});
