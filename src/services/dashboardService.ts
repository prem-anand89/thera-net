import type { UUID, Visit } from '@/domain/types';
import type { Paise } from '@/domain/money';
import { currentWeekRange, type FyMonth } from '@/domain/fiscalYear';
import { daysSince, groupOpenPackages, isStale, STALE_PACKAGE_DAYS } from '@/domain/packageTracking';
import type { Repos } from '@/repositories/types';
import { createReportService, type MonthlyReport } from './reportService';

export interface OpenPackageRow {
  packageGroupId: UUID;
  patientId: UUID;
  patientName: string;
  mrno: string;
  serviceName: string;
  sessionsLogged: number;
  packageTotal: number;
  startedOn: string;
  lastVisitOn: string;
  daysSinceLastVisit: number;
  stale: boolean;
}

export interface OutstandingInvoiceRow {
  invoiceId: UUID;
  invoiceNo: string;
  patientName: string;
  mrno: string;
  totalPaise: Paise;
  issuedAt: string;
  daysOutstanding: number;
}

export interface OutstandingSummary {
  rows: OutstandingInvoiceRow[];
  totalPaise: Paise;
  count: number;
}

export interface RecentVisitRow {
  visitId: UUID;
  visitDate: string;
  patientName: string;
  mrno: string;
  therapistName: string;
  serviceName: string;
  treatmentNotes: string | null;
  billPaise: Paise;
  hasInvoice: boolean;
}

export interface WeeklySummary {
  visitCount: number;
  /**
   * Take-home actually collected for this Mon–Sun week's visits — sums the
   * post-tax figure of visits that are invoiced AND paid. In simple mode
   * post-tax equals the bill, so this is just the collected bill amount.
   */
  collectedPaise: Paise;
}

export interface MonthlyNewCounts {
  newPackages: number;
  newPatients: number;
}

export type TodayPaymentState = 'paid' | 'outstanding' | 'uninvoiced' | 'zero_session';

export interface TodayVisitRow {
  visitId: UUID;
  patientId: UUID;
  patientName: string;
  mrno: string;
  condition: string | null;
  therapistName: string;
  serviceName: string;
  sessionIndex: number | null;
  packageTotal: number | null;
  packageGroupId: UUID | null;
  billPaise: Paise;
  invoiceId: UUID | null;
  paymentState: TodayPaymentState;
}

export interface TodayWorklist {
  visits: TodayVisitRow[];
  visitCount: number;
  /** Sum of visits whose invoice is paid (or invoiced with no explicit status row). */
  collectedPaise: Paise;
  /** Sum of visits still owed: issued-but-outstanding, or billable but not yet invoiced. */
  outstandingPaise: Paise;
}

export interface SingleVisitPatientRow {
  patientId: UUID;
  patientName: string;
  mrno: string;
  serviceName: string;
  visitDate: string;
  daysSince: number;
}

export interface RecurringPatientRow {
  patientId: UUID;
  patientName: string;
  mrno: string;
  visitCount: number;
  lastVisitOn: string;
}

/** Groups a clinic-wide visit list by patient, skipping deleted rows. */
function groupByPatient(visits: Visit[]): Map<UUID, Visit[]> {
  const byPatient = new Map<UUID, Visit[]>();
  for (const v of visits) {
    if (!byPatient.has(v.patientId)) byPatient.set(v.patientId, []);
    byPatient.get(v.patientId)!.push(v);
  }
  return byPatient;
}

/** Rolling window ending at (and including) the current calendar month. */
function lastNMonths(n: number, from = new Date()): FyMonth[] {
  const months: FyMonth[] = [];
  let year = from.getFullYear();
  let month = from.getMonth() + 1; // 1-12
  for (let i = 0; i < n; i++) {
    months.unshift({ year, month });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

export function createDashboardService(repos: Repos) {
  const reportService = createReportService(repos);

  return {
    revenueTrend(clinicId: UUID, months = 6): Promise<MonthlyReport[]> {
      return Promise.all(lastNMonths(months).map((m) => reportService.monthly(clinicId, m)));
    },

    async openPackages(clinicId: UUID): Promise<OpenPackageRow[]> {
      // Full history, deliberately unbounded: a date window would hide a
      // package's earlier sessions and miscount its progress (or resurrect
      // a completed package as open). Volume is small; visits.list scans
      // the clinic index either way.
      const [visits, catalog, patients] = await Promise.all([
        repos.visits.list({ clinicId }),
        repos.catalog.list(clinicId, true),
        repos.patients.list(clinicId),
      ]);
      const serviceName = new Map(catalog.map((c) => [c.id, c.name]));
      const patientById = new Map(patients.map((p) => [p.id, p]));

      return groupOpenPackages(visits)
        .map((g) => {
          const patient = patientById.get(g.patientId);
          return {
            packageGroupId: g.packageGroupId,
            patientId: g.patientId,
            patientName: patient?.name ?? 'Unknown',
            mrno: patient?.mrno ?? '—',
            serviceName: serviceName.get(g.serviceCatalogId) ?? 'Unknown',
            sessionsLogged: g.sessionsLogged,
            packageTotal: g.packageTotal,
            startedOn: g.startedOn,
            lastVisitOn: g.lastVisitOn,
            daysSinceLastVisit: daysSince(g.lastVisitOn),
            stale: isStale(g.lastVisitOn),
          };
        })
        .sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit);
    },

    async outstandingInvoices(clinicId: UUID): Promise<OutstandingSummary> {
      const [invoices, payments] = await Promise.all([
        repos.invoices.list(clinicId),
        repos.invoicePayments.list(clinicId),
      ]);
      // Absence of a payment row means paid (see InvoicePayment doc comment) —
      // only an explicit 'outstanding' row counts here.
      const statusByInvoiceId = new Map(payments.map((p) => [p.invoiceId, p.status]));
      const rows: OutstandingInvoiceRow[] = invoices
        .filter((inv) => statusByInvoiceId.get(inv.id) === 'outstanding')
        .map((inv) => ({
          invoiceId: inv.id,
          invoiceNo: inv.invoiceNo,
          patientName: inv.patientSnapshot.name,
          mrno: inv.patientSnapshot.mrno,
          totalPaise: inv.totalPaise,
          issuedAt: inv.issuedAt,
          daysOutstanding: daysSince(inv.issuedAt.slice(0, 10)),
        }))
        .sort((a, b) => b.daysOutstanding - a.daysOutstanding);

      return {
        rows,
        totalPaise: rows.reduce((sum, r) => sum + r.totalPaise, 0),
        count: rows.length,
      };
    },

    /** Most recent visits first, for an at-a-glance strip — not filtered by date. */
    async recentVisits(clinicId: UUID, limit = 8): Promise<RecentVisitRow[]> {
      const [visits, patients, therapists, catalog] = await Promise.all([
        repos.visits.list({ clinicId }),
        repos.patients.list(clinicId),
        repos.therapists.list(clinicId, true),
        repos.catalog.list(clinicId, true),
      ]);
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const therapistNameById = new Map(therapists.map((t) => [t.id, t.name]));
      const serviceNameById = new Map(catalog.map((c) => [c.id, c.name]));

      return [...visits]
        .sort((a, b) => b.visitDate.localeCompare(a.visitDate))
        .slice(0, limit)
        .map((v) => ({
          visitId: v.id,
          visitDate: v.visitDate,
          patientName: patientById.get(v.patientId)?.name ?? 'Unknown',
          mrno: patientById.get(v.patientId)?.mrno ?? '—',
          therapistName: therapistNameById.get(v.therapistId) ?? '—',
          serviceName: serviceNameById.get(v.serviceCatalogId) ?? '—',
          treatmentNotes: v.treatmentNotes,
          billPaise: v.actualBillPaise,
          hasInvoice: Boolean(v.invoiceId),
        }));
    },

    /**
     * Patients with exactly one visit in their entire history, past the same
     * staleness window used for packages — came once, never rebooked. A
     * retention flag: is this a one-off service, or someone who needs a nudge?
     */
    async singleVisitPatients(
      clinicId: UUID,
      thresholdDays = STALE_PACKAGE_DAYS
    ): Promise<SingleVisitPatientRow[]> {
      const [visits, patients, catalog] = await Promise.all([
        repos.visits.list({ clinicId }),
        repos.patients.list(clinicId),
        repos.catalog.list(clinicId, true),
      ]);
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const serviceNameById = new Map(catalog.map((c) => [c.id, c.name]));

      const rows: SingleVisitPatientRow[] = [];
      for (const [patientId, patientVisits] of groupByPatient(visits)) {
        if (patientVisits.length !== 1) continue;
        const v = patientVisits[0];
        const since = daysSince(v.visitDate);
        if (since <= thresholdDays) continue;
        const patient = patientById.get(patientId);
        rows.push({
          patientId,
          patientName: patient?.name ?? 'Unknown',
          mrno: patient?.mrno ?? '—',
          serviceName: serviceNameById.get(v.serviceCatalogId) ?? '—',
          visitDate: v.visitDate,
          daysSince: since,
        });
      }
      return rows.sort((a, b) => b.daysSince - a.daysSince);
    },

    /**
     * Patients with several visits in a recent rolling window — the clinic's
     * currently-engaged regulars, surfaced for recognition or an upsell
     * conversation rather than a retention worry.
     */
    async recurringPatients(
      clinicId: UUID,
      minVisits = 3,
      windowDays = 30
    ): Promise<RecurringPatientRow[]> {
      const [visits, patients] = await Promise.all([
        repos.visits.list({ clinicId }),
        repos.patients.list(clinicId),
      ]);
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - windowDays);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const recent = visits.filter((v) => v.visitDate >= cutoffStr);

      const rows: RecurringPatientRow[] = [];
      for (const [patientId, patientVisits] of groupByPatient(recent)) {
        if (patientVisits.length < minVisits) continue;
        const patient = patientById.get(patientId);
        rows.push({
          patientId,
          patientName: patient?.name ?? 'Unknown',
          mrno: patient?.mrno ?? '—',
          visitCount: patientVisits.length,
          lastVisitOn: patientVisits.map((v) => v.visitDate).sort().at(-1)!,
        });
      }
      return rows.sort((a, b) => b.visitCount - a.visitCount);
    },

    /**
     * The current Monday–Sunday week — clinic-wide, independent of table
     * filters. visitCount is all visits this week; collectedPaise is the
     * take-home for those that are invoiced AND paid (absence of a payment
     * row reads as paid, matching InvoicePayment's convention).
     */
    async weeklySummary(clinicId: UUID, asOf = new Date()): Promise<WeeklySummary> {
      const [visits, payments] = await Promise.all([
        repos.visits.list({ clinicId }),
        repos.invoicePayments.list(clinicId),
      ]);
      const { from, to } = currentWeekRange(asOf);
      const statusByInvoiceId = new Map(payments.map((p) => [p.invoiceId, p.status]));
      const isPaid = (invoiceId: UUID | null) =>
        invoiceId != null && statusByInvoiceId.get(invoiceId) !== 'outstanding';

      const weekVisits = visits.filter((v) => v.visitDate >= from && v.visitDate <= to);
      return {
        visitCount: weekVisits.length,
        collectedPaise: weekVisits
          .filter((v) => isPaid(v.invoiceId))
          .reduce((sum, v) => sum + v.postTaxPaise, 0),
      };
    },

    /**
     * Today's visits (by visitDate, not entry time) with everything a
     * physio or the front desk needs at a glance: condition, service,
     * package progress, and a single payment-state chip so "who still
     * needs to be collected from" doesn't require opening the ledger.
     */
    async todayWorklist(clinicId: UUID, asOf = new Date()): Promise<TodayWorklist> {
      const todayStr = asOf.toISOString().slice(0, 10);
      const [visits, patients, therapists, catalog, payments] = await Promise.all([
        repos.visits.list({ clinicId, from: todayStr, to: todayStr }),
        repos.patients.list(clinicId),
        repos.therapists.list(clinicId, true),
        repos.catalog.list(clinicId, true),
        repos.invoicePayments.list(clinicId),
      ]);
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const therapistNameById = new Map(therapists.map((t) => [t.id, t.name]));
      const serviceNameById = new Map(catalog.map((c) => [c.id, c.name]));
      const statusByInvoiceId = new Map(payments.map((p) => [p.invoiceId, p.status]));

      const rows: TodayVisitRow[] = visits
        .map((v): TodayVisitRow => {
          const patient = patientById.get(v.patientId);
          let paymentState: TodayPaymentState;
          if (v.actualBillPaise === 0) paymentState = 'zero_session';
          else if (!v.invoiceId) paymentState = 'uninvoiced';
          else paymentState = statusByInvoiceId.get(v.invoiceId) === 'outstanding' ? 'outstanding' : 'paid';

          return {
            visitId: v.id,
            patientId: v.patientId,
            patientName: patient?.name ?? 'Unknown',
            mrno: patient?.mrno ?? '—',
            condition: v.condition,
            therapistName: therapistNameById.get(v.therapistId) ?? '—',
            serviceName: serviceNameById.get(v.serviceCatalogId) ?? '—',
            sessionIndex: v.sessionIndex,
            packageTotal: v.packageTotal,
            packageGroupId: v.packageGroupId,
            billPaise: v.actualBillPaise,
            invoiceId: v.invoiceId,
            paymentState,
          };
        })
        .sort((a, b) => a.patientName.localeCompare(b.patientName));

      const collectedPaise = rows
        .filter((r) => r.paymentState === 'paid')
        .reduce((sum, r) => sum + r.billPaise, 0);
      const outstandingPaise = rows
        .filter((r) => r.paymentState === 'outstanding' || r.paymentState === 'uninvoiced')
        .reduce((sum, r) => sum + r.billPaise, 0);

      return { visits: rows, visitCount: rows.length, collectedPaise, outstandingPaise };
    },

    /**
     * Packages and patients whose FIRST-EVER visit falls in the given
     * calendar month — "new" this month, not just active this month.
     */
    async monthlyNewCounts(clinicId: UUID, asOf = new Date()): Promise<MonthlyNewCounts> {
      const visits = await repos.visits.list({ clinicId });
      const monthStart = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}-01`;

      const packageGroups = new Map<UUID, Visit[]>();
      for (const v of visits) {
        if (!v.packageGroupId) continue;
        if (!packageGroups.has(v.packageGroupId)) packageGroups.set(v.packageGroupId, []);
        packageGroups.get(v.packageGroupId)!.push(v);
      }
      let newPackages = 0;
      for (const group of packageGroups.values()) {
        const earliest = group.map((v) => v.visitDate).sort()[0];
        if (earliest >= monthStart) newPackages++;
      }

      let newPatients = 0;
      for (const patientVisits of groupByPatient(visits).values()) {
        const earliest = patientVisits.map((v) => v.visitDate).sort()[0];
        if (earliest >= monthStart) newPatients++;
      }

      return { newPackages, newPatients };
    },
  };
}
