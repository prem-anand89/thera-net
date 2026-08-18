import { REFERRING_SOURCE_LABELS, type UUID, type Visit } from '@/domain/types';
import type { Paise } from '@/domain/money';
import { currentWeekRange, monthDateRange, type FyMonth } from '@/domain/fiscalYear';
import { daysSince, groupOpenPackages, isStale, STALE_PACKAGE_DAYS } from '@/domain/packageTracking';
import { computeVisitPaymentState, isCollected, type VisitPaymentState } from '@/domain/paymentState';
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
  /** Therapist who logged the package's first session — for "my open packages" scoping. */
  startedByTherapistId: UUID;
  startedByTherapistName: string;
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

export interface MonthlyCollection {
  billedPaise: Paise;
  collectedPaise: Paise;
  /** null when nothing was billed that month — a rate of the empty set
   *  isn't 0%, it's undefined, and showing "0%" would read as a bad month
   *  rather than an inactive one. */
  collectionRatePct: number | null;
}

export interface RepeatVisitStats {
  /** Visits this month where the same patient's immediately preceding
   *  visit (any time before, not just within the month) was ≤30 days
   *  earlier. */
  repeatCount: number;
  totalVisits: number;
  ratePct: number | null;
}

export interface ServiceUsageRow {
  serviceId: UUID;
  serviceName: string;
  visitCount: number;
  totalBilledPaise: Paise;
}

export interface ModalityUsageRow {
  modality: string;
  count: number;
}

export interface ConditionUsagePatientRow {
  patientId: UUID;
  patientName: string;
  mrno: string;
  visitCount: number;
  revenuePaise: Paise;
}

export interface ConditionUsageRow {
  condition: string;
  count: number;
  patients: ConditionUsagePatientRow[];
}

/** condition is free text (therapists type it in, no fixed list) — capping
 *  to the top N and folding the rest into "Other" keeps this chartable
 *  without inventing a taxonomy that doesn't exist. One slot short of
 *  SERIES_COLORS' 8 so "Other" itself gets its own stable color. */
export const CONDITION_TOP_N = 7;

export interface ReferralSourcePatientRow {
  patientId: UUID;
  patientName: string;
  mrno: string;
  /** patient.referringSourceDetail — the doctor/hospital name for those two sources, free text otherwise. */
  detail: string | null;
  visitCount: number;
  revenuePaise: Paise;
}

export interface ReferralSourceStat {
  source: string;
  count: number;
  revenuePaise: Paise;
  avgRevenuePaise: Paise;
  patients: ReferralSourcePatientRow[];
}

export interface RecentVisitRow {
  visitId: UUID;
  visitDate: string;
  patientId: UUID;
  patientName: string;
  mrno: string;
  condition: string | null;
  phone: string | null;
  therapistName: string;
  serviceName: string;
  sessionIndex: number | null;
  packageTotal: number | null;
  treatmentNotes: string | null;
  billPaise: Paise;
  hasInvoice: boolean;
  invoiceId: UUID | null;
  /** Unpaid amount — no invoice yet, or invoiced but still outstanding. 0 once collected. */
  outstandingPaise: Paise;
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

export type TodayPaymentState = VisitPaymentState;

export interface TodayVisitRow {
  visitId: UUID;
  patientId: UUID;
  patientName: string;
  mrno: string;
  age: number | null;
  sex: 'M' | 'F' | 'Other' | null;
  condition: string | null;
  phone: string | null;
  therapistId: UUID;
  therapistName: string;
  serviceName: string;
  treatmentNotes: string | null;
  sessionIndex: number | null;
  packageTotal: number | null;
  packageGroupId: UUID | null;
  billPaise: Paise;
  invoiceId: UUID | null;
  paymentState: TodayPaymentState;
  /** True when this visit is flagged for a clinical note that hasn't been completed yet. */
  needsNote: boolean;
  /** Set once this visit's note is completed. */
  consultationNoteId: UUID | null;
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
  phone: string | null;
  primaryCondition: string | null;
  noReturnReasonId: UUID | null;
  noReturnReasonName: string | null;
  noReturnReasonClosed: boolean;
}

export type PendingWorkKind = 'stale_package' | 'outstanding_payment' | 'incomplete_note';

/**
 * One unresolved item from a prior visit, surfaced on the Workspace landing
 * page so nothing falls through the cracks between visits. Three unrelated
 * signals feed this list — a stale package, an unpaid bill, an unfinished
 * clinical note — deliberately kept as one merged, most-overdue-first feed
 * rather than three separate widgets.
 */
export interface PendingWorkItem {
  kind: PendingWorkKind;
  patientId: UUID | null;
  patientName: string;
  mrno: string;
  detail: string;
  amountPaise: Paise | null;
  visitId: UUID | null;
  /** Set only for the invoice-outstanding case — lets "Mark paid" toggle the invoice's status directly. */
  invoiceId: UUID | null;
  daysSince: number;
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
    /** Either a rolling window of `months` calendar months (default 6), or
     *  an explicit list of months (e.g. a fiscal year via monthsOfFiscalYear,
     *  trimmed to not run past the current month). */
    revenueTrend(clinicId: UUID, monthsOrList: number | FyMonth[] = 6): Promise<MonthlyReport[]> {
      const list = Array.isArray(monthsOrList) ? monthsOrList : lastNMonths(monthsOrList);
      return Promise.all(list.map((m) => reportService.monthly(clinicId, m)));
    },

    async openPackages(clinicId: UUID): Promise<OpenPackageRow[]> {
      // Full history, deliberately unbounded: a date window would hide a
      // package's earlier sessions and miscount its progress (or resurrect
      // a completed package as open). Volume is small; visits.list scans
      // the clinic index either way.
      const [visits, catalog, patients, therapists] = await Promise.all([
        repos.visits.list({ clinicId }),
        repos.catalog.list(clinicId, true),
        repos.patients.list(clinicId),
        repos.therapists.list(clinicId, true),
      ]);
      const serviceName = new Map(catalog.map((c) => [c.id, c.name]));
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const therapistNameById = new Map(therapists.map((t) => [t.id, t.name]));

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
            startedByTherapistId: g.startedByTherapistId,
            startedByTherapistName: therapistNameById.get(g.startedByTherapistId) ?? 'Unknown',
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

    /**
     * Billed vs. actually collected for one calendar month — the "how much
     * of what we billed did we actually get paid" number the reporting
     * pages never surfaced (revenueTrend/MonthlyReport track the BM
     * split/tax rollup, not collection status at all). Reuses
     * computeVisitPaymentState per visit — the same source of truth
     * VisitCard's payment chips and pendingWork's outstanding-payment
     * items already use — rather than a second, possibly-diverging
     * definition of "collected".
     */
    async monthlyCollection(clinicId: UUID, month: FyMonth, therapistId?: UUID): Promise<MonthlyCollection> {
      const { from, to } = monthDateRange(month);
      const [visits, invoicePayments, directPayments] = await Promise.all([
        repos.visits.list({ clinicId, from, to, therapistId }),
        repos.invoicePayments.list(clinicId),
        repos.payments.list(clinicId),
      ]);
      const statusByInvoiceId = new Map(invoicePayments.map((p) => [p.invoiceId, p.status]));
      const directByVisitId = new Map<UUID, Paise>();
      for (const p of directPayments) {
        directByVisitId.set(p.visitId, (directByVisitId.get(p.visitId) ?? 0) + p.amountPaise);
      }

      let billedPaise = 0;
      let collectedPaise = 0;
      for (const v of visits) {
        billedPaise += v.actualBillPaise;
        const state = computeVisitPaymentState(
          v.actualBillPaise,
          v.invoiceId,
          directByVisitId.get(v.id) ?? 0,
          v.invoiceId ? statusByInvoiceId.get(v.invoiceId) : undefined
        );
        if (isCollected(state)) collectedPaise += v.actualBillPaise;
      }

      return {
        billedPaise,
        collectedPaise,
        collectionRatePct: billedPaise > 0 ? Math.round((collectedPaise / billedPaise) * 100) : null,
      };
    },

    /**
     * Of the visits logged this month, how many were a prompt follow-up —
     * the same patient's immediately preceding visit (which may fall
     * before the month started) was 30 days ago or less. A retention
     * signal distinct from "New patients": this counts existing patients
     * coming back quickly, not new ones showing up at all. Needs a 30-day
     * lookback before the month starts so a visit on the 3rd can still see
     * a prior visit from the previous month.
     */
    async repeatVisits(clinicId: UUID, month: FyMonth, therapistId?: UUID): Promise<RepeatVisitStats> {
      const { from, to } = monthDateRange(month);
      const lookbackDate = new Date(`${from}T00:00:00`);
      lookbackDate.setDate(lookbackDate.getDate() - 30);
      const lookbackFrom = lookbackDate.toISOString().slice(0, 10);

      const visits = await repos.visits.list({ clinicId, from: lookbackFrom, to, therapistId });
      const inMonth = visits.filter((v) => v.visitDate >= from && v.visitDate <= to);
      const byPatient = groupByPatient(visits);

      let repeatCount = 0;
      for (const v of inMonth) {
        const priorDates = (byPatient.get(v.patientId) ?? [])
          .filter((pv) => pv.id !== v.id && pv.visitDate < v.visitDate)
          .map((pv) => pv.visitDate)
          .sort();
        const mostRecentPrior = priorDates.at(-1);
        if (mostRecentPrior && daysSince(mostRecentPrior, v.visitDate) <= 30) repeatCount++;
      }

      return {
        repeatCount,
        totalVisits: inMonth.length,
        ratePct: inMonth.length > 0 ? Math.round((repeatCount / inMonth.length) * 100) : null,
      };
    },

    /** Which billable services actually got used this month, most-visited
     *  first — "frequently used services." Scoped the same way every other
     *  monthly metric here is (clinic-wide for admin/front_desk, this
     *  therapist's own visits otherwise). */
    async serviceUsage(clinicId: UUID, month: FyMonth, therapistId?: UUID): Promise<ServiceUsageRow[]> {
      const { from, to } = monthDateRange(month);
      const [visits, catalog] = await Promise.all([
        repos.visits.list({ clinicId, from, to, therapistId }),
        repos.catalog.list(clinicId, true),
      ]);
      const nameById = new Map(catalog.map((c) => [c.id, c.name]));
      const byService = new Map<UUID, { visitCount: number; totalBilledPaise: Paise }>();
      for (const v of visits) {
        const entry = byService.get(v.serviceCatalogId) ?? { visitCount: 0, totalBilledPaise: 0 };
        entry.visitCount += 1;
        entry.totalBilledPaise += v.actualBillPaise;
        byService.set(v.serviceCatalogId, entry);
      }
      return [...byService.entries()]
        .map(([serviceId, stats]) => ({ serviceId, serviceName: nameById.get(serviceId) ?? 'Unknown', ...stats }))
        .sort((a, b) => b.visitCount - a.visitCount);
    },

    /**
     * How often each treatment modality (Ultrasound/TENS/IFC/Heat-ice/
     * Laser/Shockwave — the same preset list NoteEditorPage's Treatment
     * section already offers as a multi-select, see coreAssessment.ts) was
     * picked, across every consultation note on record — all-time, not
     * month-scoped, matching referralSourceStats' own convention rather
     * than adding a note→visit date join just for this. Only meaningful
     * for a clinic with clinicalDocsEnabled; callers should gate on that
     * rather than this returning an empty list either way.
     */
    async modalityUsage(clinicId: UUID): Promise<ModalityUsageRow[]> {
      const notes = await repos.consultationNotes.listByClinic(clinicId);
      const counts = new Map<string, number>();
      for (const n of notes) {
        const payload = n.assessmentPayload as { treatment?: { session?: { modalities?: unknown } } } | null;
        const modalities = payload?.treatment?.session?.modalities;
        if (!Array.isArray(modalities)) continue;
        for (const m of modalities) {
          if (typeof m !== 'string') continue;
          counts.set(m, (counts.get(m) ?? 0) + 1);
        }
      }
      return [...counts.entries()]
        .map(([modality, count]) => ({ modality, count }))
        .sort((a, b) => b.count - a.count);
    },

    /**
     * What's actually being treated, all-time — grouped by Visit.condition
     * (free text, trimmed only, no other normalization since anything
     * fuzzier risks merging genuinely different conditions). Top
     * CONDITION_TOP_N by visit count keep their own slice; everything else
     * folds into "Other" rather than fragmenting into a long low-value
     * tail. Each row carries its contributing patients (name/mrno/visits/
     * revenue) for a drill-down list, "Other"'s patients spanning every
     * folded condition.
     */
    async conditionUsage(clinicId: UUID): Promise<ConditionUsageRow[]> {
      const [visits, patients] = await Promise.all([
        repos.visits.list({ clinicId }),
        repos.patients.list(clinicId),
      ]);
      const patientById = new Map(patients.map((p) => [p.id, p]));

      const byCondition = new Map<string, { count: number; patients: Map<UUID, ConditionUsagePatientRow> }>();
      for (const v of visits) {
        const condition = v.condition?.trim() || 'Unspecified';
        const entry = byCondition.get(condition) ?? { count: 0, patients: new Map() };
        entry.count += 1;
        const patient = patientById.get(v.patientId);
        const patientRow = entry.patients.get(v.patientId) ?? {
          patientId: v.patientId,
          patientName: patient?.name ?? 'Unknown',
          mrno: patient?.mrno ?? '—',
          visitCount: 0,
          revenuePaise: 0 as Paise,
        };
        patientRow.visitCount += 1;
        patientRow.revenuePaise = (patientRow.revenuePaise + v.actualBillPaise) as Paise;
        entry.patients.set(v.patientId, patientRow);
        byCondition.set(condition, entry);
      }

      const ranked = [...byCondition.entries()].sort((a, b) => b[1].count - a[1].count);
      const top = ranked.slice(0, CONDITION_TOP_N);
      const rest = ranked.slice(CONDITION_TOP_N);

      const rows: ConditionUsageRow[] = top.map(([condition, { count, patients: patientRows }]) => ({
        condition,
        count,
        patients: [...patientRows.values()].sort((a, b) => b.revenuePaise - a.revenuePaise),
      }));

      if (rest.length > 0) {
        const otherPatients = new Map<UUID, ConditionUsagePatientRow>();
        let otherCount = 0;
        for (const [, { count, patients: patientRows }] of rest) {
          otherCount += count;
          for (const [patientId, row] of patientRows) {
            const existing = otherPatients.get(patientId);
            otherPatients.set(patientId, {
              ...row,
              visitCount: (existing?.visitCount ?? 0) + row.visitCount,
              revenuePaise: ((existing?.revenuePaise ?? 0) + row.revenuePaise) as Paise,
            });
          }
        }
        rows.push({
          condition: 'Other',
          count: otherCount,
          patients: [...otherPatients.values()].sort((a, b) => b.revenuePaise - a.revenuePaise),
        });
      }

      return rows;
    },

    /**
     * Everything left unresolved from a prior visit, most-overdue-first:
     * packages gone quiet, bills with no payment on record, and visits whose
     * clinical note was never finished. One merged feed for the Workspace
     * landing page — the point is nothing needs a separate trip to another
     * tab to notice it's still open.
     */
    async pendingWork(clinicId: UUID): Promise<PendingWorkItem[]> {
      const [visits, patients, catalog, invoices, invoicePayments, directPayments] = await Promise.all([
        repos.visits.list({ clinicId }),
        repos.patients.list(clinicId),
        repos.catalog.list(clinicId, true),
        repos.invoices.list(clinicId),
        repos.invoicePayments.list(clinicId),
        repos.payments.list(clinicId),
      ]);
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const serviceNameById = new Map(catalog.map((c) => [c.id, c.name]));
      const statusByInvoiceId = new Map(invoicePayments.map((p) => [p.invoiceId, p.status]));
      const paidVisitIds = new Set(directPayments.map((p) => p.visitId));

      const items: PendingWorkItem[] = [];

      for (const g of groupOpenPackages(visits)) {
        if (!isStale(g.lastVisitOn)) continue;
        const patient = patientById.get(g.patientId);
        const days = daysSince(g.lastVisitOn);
        items.push({
          kind: 'stale_package',
          patientId: g.patientId,
          patientName: patient?.name ?? 'Unknown',
          mrno: patient?.mrno ?? '—',
          detail: `${serviceNameById.get(g.serviceCatalogId) ?? 'Package'} — no visit in ${days} days`,
          amountPaise: null,
          visitId: null,
          invoiceId: null,
          daysSince: days,
        });
      }

      // Invoices explicitly marked outstanding (invoices carry no patientId,
      // only a name/mrno snapshot taken at issue time).
      for (const inv of invoices) {
        if (statusByInvoiceId.get(inv.id) !== 'outstanding') continue;
        const days = daysSince(inv.issuedAt.slice(0, 10));
        items.push({
          kind: 'outstanding_payment',
          patientId: null,
          patientName: inv.patientSnapshot.name,
          mrno: inv.patientSnapshot.mrno,
          detail: `Invoice ${inv.invoiceNo} outstanding`,
          amountPaise: inv.totalPaise,
          visitId: null,
          invoiceId: inv.id,
          daysSince: days,
        });
      }

      // Billed visits with neither an invoice nor a direct payment logged —
      // the "collect later" case Phase 1/3 introduced.
      for (const v of visits) {
        if (v.deleted || v.actualBillPaise === 0 || v.invoiceId) continue;
        if (paidVisitIds.has(v.id)) continue;
        const patient = patientById.get(v.patientId);
        const days = daysSince(v.visitDate);
        items.push({
          kind: 'outstanding_payment',
          patientId: v.patientId,
          patientName: patient?.name ?? 'Unknown',
          mrno: patient?.mrno ?? '—',
          detail: v.pendingPaymentNote ? `Marked pending: ${v.pendingPaymentNote}` : 'No payment recorded yet',
          amountPaise: v.actualBillPaise,
          visitId: v.id,
          invoiceId: null,
          daysSince: days,
        });
      }

      for (const v of visits) {
        if (v.deleted || v.clinicalStatus !== 'pending') continue;
        const patient = patientById.get(v.patientId);
        const days = daysSince(v.visitDate);
        items.push({
          kind: 'incomplete_note',
          patientId: v.patientId,
          patientName: patient?.name ?? 'Unknown',
          mrno: patient?.mrno ?? '—',
          detail: 'Clinical note not finished',
          amountPaise: null,
          visitId: v.id,
          invoiceId: null,
          daysSince: days,
        });
      }

      return items.sort((a, b) => b.daysSince - a.daysSince);
    },

    /** Most recent visits first, for an at-a-glance strip — not filtered by date. */
    async recentVisits(clinicId: UUID, limit = 8): Promise<RecentVisitRow[]> {
      const [visits, patients, therapists, catalog, invoicePayments, directPayments] = await Promise.all([
        repos.visits.list({ clinicId }),
        repos.patients.list(clinicId),
        repos.therapists.list(clinicId, true),
        repos.catalog.list(clinicId, true),
        repos.invoicePayments.list(clinicId),
        repos.payments.list(clinicId),
      ]);
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const therapistNameById = new Map(therapists.map((t) => [t.id, t.name]));
      const serviceNameById = new Map(catalog.map((c) => [c.id, c.name]));
      const statusByInvoiceId = new Map(invoicePayments.map((p) => [p.invoiceId, p.status]));
      const directPaymentByVisitId = new Map<UUID, Paise>();
      directPayments.forEach((p) => {
        directPaymentByVisitId.set(p.visitId, (directPaymentByVisitId.get(p.visitId) ?? 0) + p.amountPaise);
      });

      return [...visits]
        .sort((a, b) => b.visitDate.localeCompare(a.visitDate))
        .slice(0, limit)
        .map((v) => {
          const state = computeVisitPaymentState(
            v.actualBillPaise,
            v.invoiceId,
            directPaymentByVisitId.get(v.id) ?? 0,
            v.invoiceId ? statusByInvoiceId.get(v.invoiceId) : undefined
          );
          const outstanding = !isCollected(state) && state !== 'zero_session';
          return {
            visitId: v.id,
            visitDate: v.visitDate,
            patientId: v.patientId,
            patientName: patientById.get(v.patientId)?.name ?? 'Unknown',
            mrno: patientById.get(v.patientId)?.mrno ?? '—',
            condition: v.condition,
            phone: patientById.get(v.patientId)?.phone ?? null,
            therapistName: therapistNameById.get(v.therapistId) ?? '—',
            serviceName: serviceNameById.get(v.serviceCatalogId) ?? '—',
            sessionIndex: v.sessionIndex,
            packageTotal: v.packageTotal,
            treatmentNotes: v.treatmentNotes,
            billPaise: v.actualBillPaise,
            hasInvoice: Boolean(v.invoiceId),
            invoiceId: v.invoiceId,
            outstandingPaise: outstanding ? v.actualBillPaise : 0,
          };
        });
    },

    /**
     * Visits within a rolling day window, most recent first — backs the
     * Workspace "Recent" list's 7/15/30-day toggle. Excludes today's own
     * visits (those live on the Today list right above) so the two lists
     * read as one continuous timeline instead of overlapping. Unlike
     * recentVisits (a fixed-length at-a-glance strip), this returns every
     * visit in the window since the whole point is a complete recent
     * history, not a capped preview.
     */
    async recentVisitsWindow(clinicId: UUID, days: number, asOf = new Date()): Promise<RecentVisitRow[]> {
      const todayStr = asOf.toISOString().slice(0, 10);
      const cutoff = new Date(asOf);
      cutoff.setDate(cutoff.getDate() - days);
      const fromStr = cutoff.toISOString().slice(0, 10);
      const [visits, patients, therapists, catalog, invoicePayments, directPayments] = await Promise.all([
        repos.visits.list({ clinicId, from: fromStr }),
        repos.patients.list(clinicId),
        repos.therapists.list(clinicId, true),
        repos.catalog.list(clinicId, true),
        repos.invoicePayments.list(clinicId),
        repos.payments.list(clinicId),
      ]);
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const therapistNameById = new Map(therapists.map((t) => [t.id, t.name]));
      const serviceNameById = new Map(catalog.map((c) => [c.id, c.name]));
      const statusByInvoiceId = new Map(invoicePayments.map((p) => [p.invoiceId, p.status]));
      const directPaymentByVisitId = new Map<UUID, Paise>();
      directPayments.forEach((p) => {
        directPaymentByVisitId.set(p.visitId, (directPaymentByVisitId.get(p.visitId) ?? 0) + p.amountPaise);
      });

      return visits
        .filter((v) => v.visitDate < todayStr)
        .sort((a, b) => b.visitDate.localeCompare(a.visitDate))
        .map((v) => {
          const state = computeVisitPaymentState(
            v.actualBillPaise,
            v.invoiceId,
            directPaymentByVisitId.get(v.id) ?? 0,
            v.invoiceId ? statusByInvoiceId.get(v.invoiceId) : undefined
          );
          const outstanding = !isCollected(state) && state !== 'zero_session';
          return {
            visitId: v.id,
            visitDate: v.visitDate,
            patientId: v.patientId,
            patientName: patientById.get(v.patientId)?.name ?? 'Unknown',
            mrno: patientById.get(v.patientId)?.mrno ?? '—',
            condition: v.condition,
            phone: patientById.get(v.patientId)?.phone ?? null,
            therapistName: therapistNameById.get(v.therapistId) ?? '—',
            serviceName: serviceNameById.get(v.serviceCatalogId) ?? '—',
            sessionIndex: v.sessionIndex,
            packageTotal: v.packageTotal,
            treatmentNotes: v.treatmentNotes,
            billPaise: v.actualBillPaise,
            hasInvoice: Boolean(v.invoiceId),
            invoiceId: v.invoiceId,
            outstandingPaise: outstanding ? v.actualBillPaise : 0,
          };
        });
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
      const [visits, patients, catalog, reasons] = await Promise.all([
        repos.visits.list({ clinicId }),
        repos.patients.list(clinicId),
        repos.catalog.list(clinicId, true),
        repos.noReturnReasonCatalog.list(clinicId, true),
      ]);
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const serviceNameById = new Map(catalog.map((c) => [c.id, c.name]));
      const reasonById = new Map(reasons.map((r) => [r.id, r]));

      const rows: SingleVisitPatientRow[] = [];
      for (const [patientId, patientVisits] of groupByPatient(visits)) {
        if (patientVisits.length !== 1) continue;
        const v = patientVisits[0];
        const since = daysSince(v.visitDate);
        if (since <= thresholdDays) continue;
        const patient = patientById.get(patientId);
        const reason = patient?.noReturnReasonId ? reasonById.get(patient.noReturnReasonId) : undefined;
        rows.push({
          patientId,
          patientName: patient?.name ?? 'Unknown',
          mrno: patient?.mrno ?? '—',
          serviceName: serviceNameById.get(v.serviceCatalogId) ?? '—',
          visitDate: v.visitDate,
          daysSince: since,
          phone: patient?.phone ?? null,
          primaryCondition: patient?.primaryCondition ?? null,
          noReturnReasonId: reason?.id ?? null,
          noReturnReasonName: reason?.name ?? null,
          noReturnReasonClosed: reason?.isClosed ?? false,
        });
      }
      return rows.sort((a, b) => b.daysSince - a.daysSince);
    },

    /**
     * The current Monday–Sunday week — clinic-wide, independent of table
     * filters. visitCount is all visits this week; collectedPaise is the
     * take-home for those that are invoiced AND paid (absence of a payment
     * row reads as paid, matching InvoicePayment's convention).
     */
    async weeklySummary(clinicId: UUID, asOf = new Date(), therapistId?: UUID): Promise<WeeklySummary> {
      const [visits, payments] = await Promise.all([
        repos.visits.list({ clinicId, therapistId }),
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
    async todayWorklist(clinicId: UUID, asOf = new Date(), therapistId?: UUID): Promise<TodayWorklist> {
      const todayStr = asOf.toISOString().slice(0, 10);
      const [visits, patients, therapists, catalog, invoicePayments, directPayments] = await Promise.all([
        repos.visits.list({ clinicId, from: todayStr, to: todayStr, therapistId }),
        repos.patients.list(clinicId),
        repos.therapists.list(clinicId, true),
        repos.catalog.list(clinicId, true),
        repos.invoicePayments.list(clinicId),
        repos.payments.listByDate(clinicId, todayStr),
      ]);
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const therapistNameById = new Map(therapists.map((t) => [t.id, t.name]));
      const serviceNameById = new Map(catalog.map((c) => [c.id, c.name]));
      const statusByInvoiceId = new Map(invoicePayments.map((p) => [p.invoiceId, p.status]));

      // Map visits to their direct payment amounts
      const directPaymentByVisitId = new Map<UUID, Paise>();
      directPayments.forEach((p) => {
        const existing = directPaymentByVisitId.get(p.visitId) ?? 0;
        directPaymentByVisitId.set(p.visitId, existing + p.amountPaise);
      });

      const rows: TodayVisitRow[] = visits
        .map((v): TodayVisitRow => {
          const patient = patientById.get(v.patientId);
          const directPaymentAmount = directPaymentByVisitId.get(v.id) ?? 0;

          const paymentState = computeVisitPaymentState(
            v.actualBillPaise,
            v.invoiceId,
            directPaymentAmount,
            v.invoiceId ? statusByInvoiceId.get(v.invoiceId) : undefined
          );

          return {
            visitId: v.id,
            patientId: v.patientId,
            patientName: patient?.name ?? 'Unknown',
            mrno: patient?.mrno ?? '—',
            age: patient?.age ?? null,
            sex: patient?.sex ?? null,
            condition: v.condition,
            phone: patient?.phone ?? null,
            therapistId: v.therapistId,
            therapistName: therapistNameById.get(v.therapistId) ?? '—',
            serviceName: serviceNameById.get(v.serviceCatalogId) ?? '—',
            treatmentNotes: v.treatmentNotes,
            sessionIndex: v.sessionIndex,
            packageTotal: v.packageTotal,
            packageGroupId: v.packageGroupId,
            billPaise: v.actualBillPaise,
            invoiceId: v.invoiceId,
            paymentState,
            needsNote: v.clinicalStatus === 'pending',
            consultationNoteId: v.consultationNoteId ?? null,
          };
        })
        .sort((a, b) => a.patientName.localeCompare(b.patientName));

      // Collected = invoice payments + direct payments
      const collectedPaise = rows
        .filter((r) => isCollected(r.paymentState))
        .reduce((sum, r) => sum + r.billPaise, 0);
      const outstandingPaise = rows
        .filter((r) => r.paymentState === 'outstanding' || r.paymentState === 'uninvoiced')
        .reduce((sum, r) => sum + r.billPaise, 0);

      return { visits: rows, visitCount: rows.length, collectedPaise, outstandingPaise };
    },

    /**
     * Packages and patients whose FIRST-EVER visit falls in the given
     * calendar month — "new" this month, not just active this month.
     * `therapistId` narrows both counts to visits that therapist logged
     * (same convention as `weeklySummary`/`todayWorklist`) — Workspace
     * passes this for a therapist's own scoped tile, omits it for admin's
     * clinic-wide one.
     */
    async monthlyNewCounts(clinicId: UUID, asOf = new Date(), therapistId?: UUID): Promise<MonthlyNewCounts> {
      const visits = await repos.visits.list({ clinicId, therapistId });
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

    /**
     * Per-source visit/revenue totals, plus each source's contributing
     * patients (with their referringSourceDetail free text) so the
     * dashboard can drill down: Doctor/Hospital referral break down by
     * the referring doctor/hospital name, every other source lists its
     * patients directly. Referral source lives on Patient (one current
     * value, not per-visit), so "revenue from a source" sums every visit
     * by patients currently tagged with it.
     */
    async referralSourceStats(clinicId: UUID): Promise<ReferralSourceStat[]> {
      const visits = await repos.visits.list({ clinicId });
      const patients = await repos.patients.list(clinicId);
      const patientById = new Map(patients.map((p) => [p.id, p]));

      const bySource = new Map<string, { count: number; revenuePaise: number; patients: Map<UUID, ReferralSourcePatientRow> }>();
      for (const v of visits) {
        const patient = patientById.get(v.patientId);
        const source = patient?.referringSource ?? null;
        const sourceLabel = source ? REFERRING_SOURCE_LABELS[source] : 'Unknown';
        const entry = bySource.get(sourceLabel) ?? { count: 0, revenuePaise: 0, patients: new Map() };
        entry.count += 1;
        entry.revenuePaise += v.actualBillPaise;
        const patientRow = entry.patients.get(v.patientId) ?? {
          patientId: v.patientId,
          patientName: patient?.name ?? 'Unknown',
          mrno: patient?.mrno ?? '—',
          detail: patient?.referringSourceDetail ?? null,
          visitCount: 0,
          revenuePaise: 0 as Paise,
        };
        patientRow.visitCount += 1;
        patientRow.revenuePaise = (patientRow.revenuePaise + v.actualBillPaise) as Paise;
        entry.patients.set(v.patientId, patientRow);
        bySource.set(sourceLabel, entry);
      }

      return Array.from(bySource.entries())
        .map(([source, { count, revenuePaise, patients: patientRows }]) => ({
          source,
          count,
          revenuePaise: revenuePaise as Paise,
          avgRevenuePaise: Math.round(revenuePaise / count) as Paise,
          patients: [...patientRows.values()].sort((a, b) => b.revenuePaise - a.revenuePaise),
        }))
        .sort((a, b) => b.count - a.count);
    },
  };
}
