import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService, repos } from '@/services';
import { CONDITION_TOP_N } from '@/services/dashboardService';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { formatINR } from '@/domain/money';
import { monthName, formatDateDMY, fiscalYearOf, monthsOfFiscalYear, type FyMonth } from '@/domain/fiscalYear';
import { clinicBillingConfig, clinicShareLabels, type NoReturnReasonItem } from '@/domain/types';
import type { MonthlyReport, TherapistMonthRow } from '@/services/reportService';
import { SectionCard, StatTile, Pill, th, td, tdNum, thNum } from '@/components/ui';
import { BarChart } from '@/components/BarChart';
import { IndexedTrendChart } from '@/components/IndexedTrendChart';
import { PieChart } from '@/components/PieChart';
import { TherapistComparisonCard } from '@/components/TherapistComparisonCard';
import { SERIES_COLORS } from '@/components/chartColors';

/** Jump-nav sections, in the order they appear on the page — the "Full page
 *  restructure" this became: a long undifferentiated scroll of 6 cards had
 *  no way to jump to a specific one, same complaint the note editor had
 *  before its own jump-nav. "Therapist comparison" is conditional (only
 *  when TherapistComparisonCard itself would render something), so it's
 *  filtered per-render rather than being a fixed list. */
const DASHBOARD_SECTIONS: { key: string; label: string }[] = [
  { key: 'singleVisit', label: 'Single-visit patients' },
  { key: 'revenue', label: 'Revenue trend' },
  { key: 'therapistComparison', label: 'Therapist comparison' },
  { key: 'serviceUsage', label: 'Frequently used services' },
  { key: 'modalityUsage', label: 'Treatment modalities' },
  { key: 'conditionUsage', label: 'Conditions' },
  { key: 'referralSources', label: 'Referral sources' },
];

/** Small helper for the KPI strip's up/down badge — null (not 0%) when the
 *  previous period was zero, since "up from nothing" isn't a meaningful
 *  percentage and showing one (often a huge or infinite number) would be
 *  actively misleading rather than just uninformative. */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** One "at a glance" KPI — value plus an optional trend badge versus the
 *  prior period. A plain StatTile has no room for the trend half of "more/
 *  better charts"; this is that shape without becoming a full chart component. */
function KpiCard({
  label,
  value,
  trendPct,
  trendLabel,
  lastMonthValue,
}: {
  label: string;
  value: ReactNode;
  trendPct?: number | null;
  trendLabel?: string;
  /** The prior month's raw value, e.g. "₹38,200" — the ▲/▼ badge alone
   *  never showed what it was a percentage OF. */
  lastMonthValue?: ReactNode;
}) {
  return (
    <div className="min-w-[140px] flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-num text-2xl font-semibold text-[var(--ink)]">{value}</span>
        {trendPct != null && (
          <span
            className="font-num text-xs font-semibold"
            style={{ color: trendPct >= 0 ? 'var(--moss)' : 'var(--rust)' }}
          >
            {trendPct >= 0 ? '▲' : '▼'} {Math.abs(trendPct)}%
          </span>
        )}
      </div>
      {(trendLabel || lastMonthValue != null) && (
        <div className="mt-0.5 text-[11px] text-[var(--muted)]">
          {trendLabel}
          {trendLabel && lastMonthValue != null && ' · '}
          {lastMonthValue != null && <>Last month: {lastMonthValue}</>}
        </div>
      )}
    </div>
  );
}

const ZERO_MONTH_ROW: Omit<TherapistMonthRow, 'therapistId' | 'therapistName'> = {
  billPaise: 0,
  bmSharePaise: 0,
  tdsPaise: 0,
  postTaxPaise: 0,
  hvPaise: 0,
  adjustmentPaise: 0,
  sharedPaise: 0,
  netPostTaxPaise: 0,
  attributedRevenuePaise: 0,
  visitCount: 0,
  uniquePatients: 0,
};

/** Buckets a list of counts-with-a-number into fixed ranges for a small
 *  histogram — the shape "single-visit patients" needs (how overdue). */
function bucketCounts(values: number[], edges: { max: number; label: string }[]): number[] {
  const counts = new Array(edges.length).fill(0) as number[];
  for (const v of values) {
    const idx = edges.findIndex((e) => v <= e.max);
    counts[idx === -1 ? edges.length - 1 : idx]++;
  }
  return counts;
}

/** Which bucket index a single value falls into, for filtering a list by
 *  the same edges a BarChart derived from bucketCounts is showing. */
function bucketIndexOf(value: number, edges: { max: number }[]): number {
  const idx = edges.findIndex((e) => value <= e.max);
  return idx === -1 ? edges.length - 1 : idx;
}

const SINGLE_VISIT_BUCKET_EDGES = [
  { max: 30, label: '15–30d' },
  { max: 60, label: '31–60d' },
  { max: Infinity, label: '60d+' },
];

export function ReportsOverviewPage() {
  const clinic = useClinic();
  const scope = useWorkspaceScope();
  const labels = clinicShareLabels(clinic);
  const { hospitalSplit } = clinicBillingConfig(clinic);
  const revenueLabel = hospitalSplit ? `Post-Tax ${labels.own}` : 'Revenue';

  // Revenue trend period — the KPI strip's "this/last month" figures only
  // ever read the final two entries, which stay the same regardless of how
  // far back the window extends, so one query serves both the KPI strip and
  // the trend chart below.
  const [trendPeriod, setTrendPeriod] = useState<'6m' | 'ytd' | 'fy'>('6m');
  const currentFy = fiscalYearOf(new Date(), clinic.fyStartMonth);
  const trendMonthsArg = useMemo((): number | FyMonth[] => {
    if (trendPeriod === 'ytd') {
      const now = new Date();
      const months: FyMonth[] = [];
      for (let m = 1; m <= now.getMonth() + 1; m++) months.push({ year: now.getFullYear(), month: m });
      return months;
    }
    if (trendPeriod === 'fy') {
      const now = new Date();
      const nowKey = now.getFullYear() * 12 + now.getMonth() + 1;
      return monthsOfFiscalYear(currentFy.startYear, clinic.fyStartMonth).filter(
        (m) => m.year * 12 + m.month <= nowKey
      );
    }
    return 6;
  }, [trendPeriod, currentFy.startYear, clinic.fyStartMonth]);
  const trendPeriodLabel =
    trendPeriod === '6m' ? 'last 6 months' : trendPeriod === 'ytd' ? `YTD ${new Date().getFullYear()}` : `FY ${currentFy.label}`;

  const trend = useLiveQuery(
    () => dashboardService.revenueTrend(clinic.id, trendMonthsArg),
    [clinic.id, trendMonthsArg]
  );
  const singleVisitPatients = useLiveQuery(
    () => dashboardService.singleVisitPatients(clinic.id),
    [clinic.id]
  );
  const referralSources = useLiveQuery(
    () => dashboardService.referralSourceStats(clinic.id),
    [clinic.id]
  );
  const serviceUsage = useLiveQuery(
    () => dashboardService.serviceUsage(clinic.id, { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }, scope.scopeTherapistId),
    [clinic.id, scope.scopeTherapistId]
  );
  const modalityUsage = useLiveQuery(
    () => (clinic.clinicalDocsEnabled ? dashboardService.modalityUsage(clinic.id) : undefined),
    [clinic.id, clinic.clinicalDocsEnabled]
  );
  const conditionUsage = useLiveQuery(() => dashboardService.conditionUsage(clinic.id), [clinic.id]);

  // KPI strip data — current calendar month, plus one month back for the
  // trend badges. now/prevMonth are recomputed each render (cheap, plain
  // Date math) rather than memoized; only their derived year/month numbers
  // feed the query deps, so a re-render mid-month doesn't refetch.
  const now = new Date();
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const repeatVisitsThisMonth = useLiveQuery(
    () =>
      dashboardService.repeatVisits(
        clinic.id,
        { year: now.getFullYear(), month: now.getMonth() + 1 },
        scope.scopeTherapistId
      ),
    [clinic.id, now.getFullYear(), now.getMonth(), scope.scopeTherapistId]
  );
  const newPatientsThisMonth = useLiveQuery(
    () => dashboardService.monthlyNewCounts(clinic.id, now, scope.scopeTherapistId),
    [clinic.id, now.getFullYear(), now.getMonth(), scope.scopeTherapistId]
  );
  const newPatientsLastMonth = useLiveQuery(
    () => dashboardService.monthlyNewCounts(clinic.id, prevMonthDate, scope.scopeTherapistId),
    [clinic.id, prevMonthDate.getFullYear(), prevMonthDate.getMonth(), scope.scopeTherapistId]
  );
  const repeatVisitsLastMonth = useLiveQuery(
    () =>
      dashboardService.repeatVisits(
        clinic.id,
        { year: prevMonthDate.getFullYear(), month: prevMonthDate.getMonth() + 1 },
        scope.scopeTherapistId
      ),
    [clinic.id, prevMonthDate.getFullYear(), prevMonthDate.getMonth(), scope.scopeTherapistId]
  );

  const categories = useMemo(
    () => (trend ?? []).map((r) => `${monthName(r.month.month).slice(0, 3)} '${String(r.month.year).slice(2)}`),
    [trend]
  );

  // A trend line built mostly from months with zero activity (a clinic only
  // a few weeks old, or a therapist who just joined) reads as a dramatic
  // spike rather than what it actually is — not enough history yet.
  const monthsWithActivity = useMemo(
    () => (trend ?? []).filter((r) => r.total.visitCount > 0).length,
    [trend]
  );
  const hasEnoughTrendHistory = monthsWithActivity >= 2;

  // For a therapist, "the trend" is their own row each month — falling back
  // to an explicit zero row for a month they had no visits in, rather than
  // the whole clinic's total.
  const myMonthRow = (rows: TherapistMonthRow[]): TherapistMonthRow =>
    rows.find((row) => row.therapistId === scope.myTherapistId) ?? {
      ...ZERO_MONTH_ROW,
      therapistId: scope.myTherapistId ?? 'none',
      therapistName: '',
    };

  // Revenue and packages-this-month vs last month, from the 6-month trend
  // and monthlyNewCounts pair already being fetched for the chart/other
  // KPIs — their last two entries are this month and last, so no extra
  // query for either KPI card.
  // Clinic-wide (admin) keeps the actual post-tax/billed figure — the
  // financial number the clinic runs on, unaffected by attribution since a
  // total is invariant to how it's split across therapists. A single
  // therapist's own figure instead uses attributedRevenuePaise: without it,
  // "my revenue" credits 100% of a package to whoever logged its first
  // (billed) session and 0% to a colleague who ran the rest of it.
  const revenueRow = (report: MonthlyReport | undefined) => {
    if (!report) return null;
    if (scope.isClinicWideView) return hospitalSplit ? report.total.postTaxPaise : report.total.billPaise;
    return myMonthRow(report.rows).attributedRevenuePaise;
  };
  const revenueThisMonth = trend ? revenueRow(trend[trend.length - 1]) : null;
  const revenueLastMonth = trend && trend.length > 1 ? revenueRow(trend[trend.length - 2]) : null;

  // Average charge/session — always the clinic-wide figure, not scoped to
  // just one therapist (per request: "a clinic overall metric"), from the
  // same latest trend entry.
  const latestReport = trend?.[trend.length - 1];
  const avgChargePerSession =
    latestReport && latestReport.total.visitCount > 0
      ? Math.round(latestReport.total.billPaise / latestReport.total.visitCount)
      : null;

  // Jump-nav: mobile chips + desktop rail, same sticky/IntersectionObserver
  // pattern as the note editor's — a flat list here (no SOAP-style
  // grouping) since six items reads fine as one row/column without it.
  const [activeSection, setActiveSection] = useState(DASHBOARD_SECTIONS[0].key);
  const sectionRefs = useRef(new Map<string, HTMLDivElement>());
  const suppressSpyRef = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (suppressSpyRef.current) return;
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) => (a.boundingClientRect.top <= b.boundingClientRect.top ? a : b));
        const key = [...sectionRefs.current.entries()].find(([, el]) => el === topMost.target)?.[0];
        if (key) setActiveSection(key);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 }
    );
    for (const el of sectionRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function jumpToSection(key: string) {
    setActiveSection(key);
    suppressSpyRef.current = true;
    sectionRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      suppressSpyRef.current = false;
    }, 600);
  }

  const showTherapistComparison = scope.isAdmin && clinic.showTherapistComparison;
  const jumpTargets = DASHBOARD_SECTIONS.filter(
    (s) =>
      (s.key !== 'therapistComparison' || showTherapistComparison) &&
      (s.key !== 'modalityUsage' || clinic.clinicalDocsEnabled)
  );

  // Referral sources — a slice is always "active" (defaults to the top
  // source) so the detail panel never goes blank; clicking re-picks which
  // one, but never toggles off to nothing (that's what PieChart's own
  // deselect-to-null would otherwise do on a second click of the same slice).
  const [referralSelectedIdx, setReferralSelectedIdx] = useState<number | null>(null);
  const referralActiveIdx = referralSelectedIdx ?? 0;
  const referralActive = referralSources?.[referralActiveIdx];
  const referralNeedsDetail = referralActive?.detailLabel != null;
  const referralDetailGroups = useMemo(() => {
    if (!referralActive || !referralNeedsDetail) return [];
    const byDetail = new Map<string, { patients: number; visits: number; revenuePaise: number }>();
    for (const p of referralActive.patients) {
      const key = p.detail?.trim() || 'Unspecified';
      const entry = byDetail.get(key) ?? { patients: 0, visits: 0, revenuePaise: 0 };
      entry.patients += 1;
      entry.visits += p.visitCount;
      entry.revenuePaise += p.revenuePaise;
      byDetail.set(key, entry);
    }
    return [...byDetail.entries()].sort((a, b) => b[1].revenuePaise - a[1].revenuePaise);
  }, [referralActive, referralNeedsDetail]);

  // Conditions — unlike referral sources, no default slice: nothing is
  // selected until clicked, since there's no one "always relevant" answer.
  const [conditionSelectedIdx, setConditionSelectedIdx] = useState<number | null>(null);
  const conditionActive = conditionSelectedIdx != null ? conditionUsage?.[conditionSelectedIdx] : undefined;

  const singleVisitBuckets = useMemo(
    () => bucketCounts((singleVisitPatients ?? []).map((p) => p.daysSince), SINGLE_VISIT_BUCKET_EDGES),
    [singleVisitPatients]
  );
  // Clicking a histogram bar filters the list below to that day-range;
  // null means "show everyone" (the default, and the BarChart itself has
  // no "all" bar to click back to, so a Clear affordance covers that).
  const [singleVisitBucketFilter, setSingleVisitBucketFilter] = useState<number | null>(null);
  const [hideClosedReasons, setHideClosedReasons] = useState(false);
  const filteredSingleVisit = useMemo(() => {
    let rows = singleVisitPatients ?? [];
    if (singleVisitBucketFilter != null) {
      rows = rows.filter((p) => bucketIndexOf(p.daysSince, SINGLE_VISIT_BUCKET_EDGES) === singleVisitBucketFilter);
    }
    if (hideClosedReasons) rows = rows.filter((p) => !p.noReturnReasonClosed);
    return rows;
  }, [singleVisitPatients, singleVisitBucketFilter, hideClosedReasons]);

  // The clinic's own "why didn't they come back" list — same editable-list
  // shape as the service catalog (see Catalog() in Settings), managed
  // inline here rather than routed through Settings since it's only ever
  // used from this one spot.
  const noReturnReasons = useLiveQuery(() => repos.noReturnReasonCatalog.list(clinic.id, true), [clinic.id]);
  const [manageReasonsOpen, setManageReasonsOpen] = useState(false);
  const [reasonDraftName, setReasonDraftName] = useState('');
  const [reasonDraftClosed, setReasonDraftClosed] = useState(false);

  async function addReason() {
    const name = reasonDraftName.trim();
    if (!name) return;
    await repos.noReturnReasonCatalog.put({
      id: crypto.randomUUID(),
      clinicId: clinic.id,
      name,
      isClosed: reasonDraftClosed,
      active: true,
      updatedAt: new Date().toISOString(),
    });
    setReasonDraftName('');
    setReasonDraftClosed(false);
  }

  async function toggleReasonActive(item: NoReturnReasonItem) {
    await repos.noReturnReasonCatalog.put({ ...item, active: !item.active, updatedAt: new Date().toISOString() });
  }

  async function setPatientReason(patientId: string, reasonId: string) {
    const patient = await repos.patients.get(patientId);
    if (!patient) return;
    await repos.patients.put({
      ...patient,
      noReturnReasonId: reasonId || null,
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <div className="space-y-5">
      {/* "At a glance" KPI strip — the top-of-page hierarchy this page
          otherwise lacked entirely; a long scroll of section cards gave no
          sense of "how's this month going" without reading the revenue
          chart. Trend badges compare to the prior calendar month; null
          (not a literal "0%") when there's nothing to compare against yet. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label={scope.isClinicWideView ? revenueLabel : `My ${revenueLabel}`}
          value={revenueThisMonth != null ? formatINR(revenueThisMonth) : '—'}
          trendPct={revenueThisMonth != null && revenueLastMonth != null ? pctChange(revenueThisMonth, revenueLastMonth) : null}
          trendLabel="vs last month"
          lastMonthValue={revenueLastMonth != null ? formatINR(revenueLastMonth) : undefined}
        />
        <KpiCard
          label="Avg charge/session"
          value={avgChargePerSession != null ? formatINR(avgChargePerSession) : '—'}
          trendLabel="clinic-wide, this month"
        />
        <KpiCard
          label={scope.isClinicWideView ? 'Repeat visits (30d)' : 'My repeat visits (30d)'}
          value={repeatVisitsThisMonth?.ratePct != null ? `${repeatVisitsThisMonth.ratePct}%` : '—'}
          trendPct={
            repeatVisitsThisMonth?.ratePct != null && repeatVisitsLastMonth?.ratePct != null
              ? pctChange(repeatVisitsThisMonth.ratePct, repeatVisitsLastMonth.ratePct)
              : null
          }
          trendLabel={
            repeatVisitsThisMonth
              ? `${repeatVisitsThisMonth.repeatCount} of ${repeatVisitsThisMonth.totalVisits} visits`
              : undefined
          }
          lastMonthValue={repeatVisitsLastMonth?.ratePct != null ? `${repeatVisitsLastMonth.ratePct}%` : undefined}
        />
        <KpiCard
          label={scope.isClinicWideView ? 'New patients' : 'My new patients'}
          value={newPatientsThisMonth?.newPatients ?? '—'}
          trendPct={
            newPatientsThisMonth && newPatientsLastMonth
              ? pctChange(newPatientsThisMonth.newPatients, newPatientsLastMonth.newPatients)
              : null
          }
          trendLabel="vs last month"
          lastMonthValue={newPatientsLastMonth ? newPatientsLastMonth.newPatients : undefined}
        />
        <KpiCard
          label={scope.isClinicWideView ? 'Packages this month' : 'My packages this month'}
          value={newPatientsThisMonth?.newPackages ?? '—'}
          lastMonthValue={newPatientsLastMonth ? newPatientsLastMonth.newPackages : undefined}
        />
      </div>

      {/* Jump-nav — sticky under Shell's own header, same pattern the note
          editor uses. A horizontal chip row at every width now (used to be
          mobile-only, with a persistent left-side rail taking sidebar
          space on desktop) — the rail cost more room than a page of
          reference cards, glanced at rather than edited, actually needed. */}
      <nav className="sticky top-14 z-[1] -mx-4 flex gap-1.5 overflow-x-auto border-b border-[var(--border)] bg-[var(--paper)] px-4 py-2">
        {jumpTargets.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => jumpToSection(key)}
            className="flex shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-medium"
            style={{
              background: activeSection === key ? 'var(--teal-light)' : 'var(--surface)',
              borderColor: activeSection === key ? 'transparent' : 'var(--border)',
              color: activeSection === key ? 'var(--teal)' : 'var(--muted)',
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="space-y-6">
          <div
            ref={(el) => {
              if (el) sectionRefs.current.set('singleVisit', el);
              else sectionRefs.current.delete('singleVisit');
            }}
            className="scroll-mt-28 md:scroll-mt-20"
          >
            <SectionCard title="Single-visit patients">
              <div className="mb-3 flex items-start justify-between gap-3">
                <p className="text-xs text-[var(--muted)]">
                  Exactly one visit on record, more than 14 days ago — click a bar to filter, call from the
                  list, or log why they didn't return once you know.
                </p>
                <button
                  type="button"
                  onClick={() => setManageReasonsOpen((o) => !o)}
                  className="shrink-0 text-xs font-medium text-[var(--teal)] hover:underline"
                >
                  {manageReasonsOpen ? 'Done' : 'Manage reasons'}
                </button>
              </div>
              {manageReasonsOpen && (
                <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-3">
                  <p className="mb-2 text-xs text-[var(--muted)]">
                    Your clinic's own list — turn ones you don't use off, or add your own. "Counts as closed"
                    reasons (e.g. Resolved, Relocated) can be hidden from the list below with the checkbox.
                  </p>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {(noReturnReasons ?? []).map((r) => (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] py-1 pl-2.5 pr-1 text-xs"
                        style={r.active ? {} : { opacity: 0.5, textDecoration: 'line-through' }}
                      >
                        {r.name}
                        {r.isClosed && <span className="text-[var(--muted)]">(closed)</span>}
                        <button
                          type="button"
                          onClick={() => void toggleReasonActive(r)}
                          className="rounded-full px-1.5 text-[var(--muted)] hover:bg-[var(--paper)]"
                          title={r.active ? 'Deactivate' : 'Reactivate'}
                        >
                          {r.active ? '×' : '+'}
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={reasonDraftName}
                      onChange={(e) => setReasonDraftName(e.target.value)}
                      placeholder="Add a reason…"
                      className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                      <input
                        type="checkbox"
                        checked={reasonDraftClosed}
                        onChange={(e) => setReasonDraftClosed(e.target.checked)}
                      />
                      Counts as closed
                    </label>
                    <button type="button" onClick={() => void addReason()} className="rounded-md bg-[var(--teal)] px-3 py-1.5 text-xs font-medium text-white">
                      + Add
                    </button>
                  </div>
                </div>
              )}
              {singleVisitPatients === undefined ? null : singleVisitPatients.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--muted)]">No lapsed single-visit patients right now.</p>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-4">
                    <StatTile label="Total" value={singleVisitPatients.length} />
                    <div className="min-w-0 flex-1">
                      <BarChart
                        categories={SINGLE_VISIT_BUCKET_EDGES.map((e) => e.label)}
                        series={[{ label: 'Patients', color: SERIES_COLORS[0], values: singleVisitBuckets }]}
                        height={140}
                        selectedCategoryIndex={singleVisitBucketFilter}
                        onCategoryClick={(i) => setSingleVisitBucketFilter((prev) => (prev === i ? null : i))}
                      />
                    </div>
                  </div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    {singleVisitBucketFilter != null ? (
                      <button
                        type="button"
                        onClick={() => setSingleVisitBucketFilter(null)}
                        className="text-xs font-medium text-[var(--teal)] hover:underline"
                      >
                        Showing {SINGLE_VISIT_BUCKET_EDGES[singleVisitBucketFilter].label} only — clear filter
                      </button>
                    ) : (
                      <span />
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                      <input
                        type="checkbox"
                        checked={hideClosedReasons}
                        onChange={(e) => setHideClosedReasons(e.target.checked)}
                      />
                      Hide closed reasons
                    </label>
                  </div>
                  <div className="max-h-96 divide-y divide-[var(--border)] overflow-y-auto rounded-lg border border-[var(--border)]">
                    {filteredSingleVisit.slice(0, 50).map((p) => (
                      <div key={p.patientId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <Link to="/ledger" search={{ patientId: p.patientId }} className="text-sm font-medium text-[var(--ink)] hover:underline">
                            {p.patientName}
                          </Link>
                          <div className="text-xs text-[var(--muted)]">
                            {p.mrno} · last seen {formatDateDMY(p.visitDate)} · {p.daysSince}d ago
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          {p.primaryCondition && <Pill tone="slate">{p.primaryCondition}</Pill>}
                          <select
                            value={p.noReturnReasonId ?? ''}
                            onChange={(e) => void setPatientReason(p.patientId, e.target.value)}
                            className="rounded-full border px-2 py-1 text-xs font-medium"
                            style={
                              p.noReturnReasonName
                                ? p.noReturnReasonClosed
                                  ? { background: 'var(--moss-light)', color: 'var(--moss-strong)', borderColor: 'transparent' }
                                  : { background: 'var(--amber-light)', color: 'var(--amber)', borderColor: 'transparent' }
                                : { background: 'var(--surface)', color: 'var(--muted)', borderStyle: 'dashed' }
                            }
                          >
                            <option value="">+ Reason</option>
                            {(noReturnReasons ?? [])
                              .filter((r) => r.active || r.id === p.noReturnReasonId)
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                          </select>
                          {p.phone && (
                            <a
                              href={`tel:${p.phone}`}
                              className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)]"
                            >
                              📞 {p.phone}
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {filteredSingleVisit.length > 50 && (
                    <p className="mt-2 text-center text-xs text-[var(--muted)]">
                      Showing 50 of {filteredSingleVisit.length}.
                    </p>
                  )}
                </>
              )}
            </SectionCard>
          </div>

          <div
            ref={(el) => {
              if (el) sectionRefs.current.set('revenue', el);
              else sectionRefs.current.delete('revenue');
            }}
            className="scroll-mt-28 md:scroll-mt-20"
          >
            <SectionCard
              title={scope.isClinicWideView ? `Revenue trend — ${trendPeriodLabel} (${revenueLabel})` : `My revenue trend — ${trendPeriodLabel} (${revenueLabel})`}
            >
              <div className="mb-3 flex gap-1.5">
                {(
                  [
                    { key: '6m', label: '6 months' },
                    { key: 'ytd', label: 'YTD' },
                    { key: 'fy', label: `FY ${currentFy.label}` },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setTrendPeriod(opt.key)}
                    className="rounded-full border px-3 py-1 text-xs font-medium"
                    style={{
                      background: trendPeriod === opt.key ? 'var(--teal-light)' : 'var(--surface)',
                      borderColor: trendPeriod === opt.key ? 'transparent' : 'var(--border)',
                      color: trendPeriod === opt.key ? 'var(--teal)' : 'var(--muted)',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {trend && !hasEnoughTrendHistory && (
                <p className="py-8 text-center text-sm text-[var(--muted)]">
                  Not enough data yet — a trend needs at least two months of visits to be meaningful.
                </p>
              )}
              {trend && hasEnoughTrendHistory && (
                <>
                  <IndexedTrendChart
                    categories={categories}
                    barLabel={revenueLabel}
                    barColor={SERIES_COLORS[0]}
                    formatBarValue={formatINR}
                    barValues={
                      scope.isClinicWideView
                        ? trend.map((r) => (hospitalSplit ? r.total.postTaxPaise : r.total.billPaise))
                        : trend.map((r) => myMonthRow(r.rows).attributedRevenuePaise)
                    }
                    lineLabel="Visits"
                    lineColor={SERIES_COLORS[1]}
                    lineValues={
                      scope.isClinicWideView
                        ? trend.map((r) => r.total.visitCount)
                        : trend.map((r) => myMonthRow(r.rows).visitCount)
                    }
                  />
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-3 text-xs text-[var(--muted)]">
                    <span aria-hidden="true">ⓘ</span>
                    <span>
                      Both lines are indexed to the first active month = 100, not plotted in rupees/visits on two
                      different scales. A true dual-axis chart lets you pick the scales, which can make any two
                      lines look correlated whether or not they are — indexing keeps the comparison honest while
                      still showing which moved more. Hover a point for the real rupee/visit figure.
                    </span>
                  </div>
                </>
              )}
            </SectionCard>
          </div>

          {showTherapistComparison && (
            <div
              ref={(el) => {
                if (el) sectionRefs.current.set('therapistComparison', el);
                else sectionRefs.current.delete('therapistComparison');
              }}
              className="scroll-mt-28 md:scroll-mt-20"
            >
              <TherapistComparisonCard />
            </div>
          )}

          <div
            ref={(el) => {
              if (el) sectionRefs.current.set('serviceUsage', el);
              else sectionRefs.current.delete('serviceUsage');
            }}
            className="scroll-mt-28 md:scroll-mt-20"
          >
            <SectionCard title={scope.isClinicWideView ? 'Frequently used services — this month' : 'My frequently used services — this month'}>
              <p className="mb-3 text-xs text-[var(--muted)]">
                Which billable services actually got used this month, most-visited first.
              </p>
              {serviceUsage === undefined ? null : serviceUsage.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--muted)]">No visits logged yet this month.</p>
              ) : (
                <ul className="space-y-2">
                  {serviceUsage.slice(0, 5).map((s) => (
                    <li key={s.serviceId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-[var(--ink)]">{s.serviceName}</span>
                      <span className="flex items-center gap-3">
                        <span className="font-num text-[var(--muted)]">{s.visitCount} visits</span>
                        <span className="font-num text-[var(--muted)]">{formatINR(s.totalBilledPaise)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          {clinic.clinicalDocsEnabled && (
            <div
              ref={(el) => {
                if (el) sectionRefs.current.set('modalityUsage', el);
                else sectionRefs.current.delete('modalityUsage');
              }}
              className="scroll-mt-28 md:scroll-mt-20"
            >
              <SectionCard title="Treatment modalities">
                <p className="mb-3 text-xs text-[var(--muted)]">
                  How often each modality gets picked in clinical notes, across everyone on record — a look
                  at which techniques actually get used, not just what's offered.
                </p>
                {modalityUsage === undefined ? null : modalityUsage.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[var(--muted)]">
                    No modalities recorded in any clinical note yet.
                  </p>
                ) : (
                  <BarChart
                    categories={modalityUsage.map((m) => m.modality)}
                    series={[{ label: 'Times used', color: SERIES_COLORS[2], values: modalityUsage.map((m) => m.count) }]}
                  />
                )}
              </SectionCard>
            </div>
          )}

          <div
            ref={(el) => {
              if (el) sectionRefs.current.set('conditionUsage', el);
              else sectionRefs.current.delete('conditionUsage');
            }}
            className="scroll-mt-28 md:scroll-mt-20"
          >
            <SectionCard title="Conditions">
              <p className="mb-4 text-xs text-[var(--muted)]">
                What you're actually treating, all-time — click a slice for the patient list. Free-text
                conditions past the top {CONDITION_TOP_N} fold into "Other" rather than fragmenting.
              </p>
              {conditionUsage === undefined ? null : conditionUsage.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--muted)]">No visits logged yet.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <PieChart
                    data={conditionUsage.map((c) => ({ label: c.condition, value: c.count }))}
                    selectedIndex={conditionSelectedIdx}
                    onSelect={setConditionSelectedIdx}
                  />
                  {conditionActive ? (
                    <div>
                      <div className="mb-2 flex items-baseline justify-between gap-2">
                        <h3 className="text-sm font-medium text-[var(--ink)]">{conditionActive.condition}</h3>
                        <span className="text-xs text-[var(--muted)]">
                          {conditionActive.patients.length} patient{conditionActive.patients.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--border)]">
                        <table className="min-w-full divide-y divide-[var(--border)]">
                          <thead className="sticky top-0 bg-[var(--paper)]">
                            <tr>
                              <th className={th}>Patient</th>
                              <th className={thNum}>Visits</th>
                              <th className={thNum}>Revenue</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border)]">
                            {conditionActive.patients.map((p) => (
                              <tr key={p.patientId}>
                                <td className={td}>
                                  {p.patientName} <span className="text-[var(--muted)]">{p.mrno}</span>
                                </td>
                                <td className={tdNum}>{p.visitCount}</td>
                                <td className={tdNum}>{formatINR(p.revenuePaise)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <p className="flex items-center justify-center py-8 text-center text-sm text-[var(--muted)]">
                      Click a slice to see who's being treated for it.
                    </p>
                  )}
                </div>
              )}
            </SectionCard>
          </div>

          <div
            ref={(el) => {
              if (el) sectionRefs.current.set('referralSources', el);
              else sectionRefs.current.delete('referralSources');
            }}
            className="scroll-mt-28 md:scroll-mt-20"
          >
            <SectionCard title="Referral sources">
              <p className="mb-4 text-xs text-[var(--muted)]">
                Click a slice — Doctor/Hospital referral break down by name; everything else lists its patients.
              </p>
              {referralSources && referralSources.length > 0 && referralActive ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <PieChart
                    data={referralSources.map((r) => ({ label: r.source, value: r.count }))}
                    showPercent
                    selectedIndex={referralActiveIdx}
                    onSelect={(i) => {
                      if (i != null) setReferralSelectedIdx(i);
                    }}
                  />
                  <div>
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <h3 className="text-sm font-medium text-[var(--ink)]">{referralActive.source}</h3>
                      <span className="text-xs text-[var(--muted)]">
                        {referralActive.patients.length} patient{referralActive.patients.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                      <table className="min-w-full divide-y divide-[var(--border)]">
                        {referralNeedsDetail ? (
                          <>
                            <thead className="bg-[var(--paper)]">
                              <tr>
                                <th className={th}>{referralActive.detailLabel ?? 'Name'}</th>
                                <th className={thNum}>Patients</th>
                                <th className={thNum}>Visits</th>
                                <th className={thNum}>Revenue</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                              {referralDetailGroups.map(([name, g]) => (
                                <tr key={name}>
                                  <td className={td}>{name}</td>
                                  <td className={tdNum}>{g.patients}</td>
                                  <td className={tdNum}>{g.visits}</td>
                                  <td className={tdNum}>{formatINR(g.revenuePaise)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </>
                        ) : (
                          <>
                            <thead className="bg-[var(--paper)]">
                              <tr>
                                <th className={th}>Patient</th>
                                <th className={thNum}>Visits</th>
                                <th className={thNum}>Revenue</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                              {referralActive.patients.map((p) => (
                                <tr key={p.patientId}>
                                  <td className={td}>
                                    {p.patientName} <span className="text-[var(--muted)]">{p.mrno}</span>
                                  </td>
                                  <td className={tdNum}>{p.visitCount}</td>
                                  <td className={tdNum}>{formatINR(p.revenuePaise)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </>
                        )}
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-[var(--muted)]">No referral data yet.</p>
              )}
            </SectionCard>
          </div>
        </div>
    </div>
  );
}
