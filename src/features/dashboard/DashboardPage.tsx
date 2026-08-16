import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { formatINR } from '@/domain/money';
import { monthName, formatDateDMY, fiscalYearOf, monthsOfFiscalYear, type FyMonth } from '@/domain/fiscalYear';
import { clinicBillingConfig, clinicShareLabels } from '@/domain/types';
import type { MonthlyReport, TherapistMonthRow } from '@/services/reportService';
import { SectionCard, StatTile, Pill, PackageThread, th, td, tdNum, thNum } from '@/components/ui';
import { BarChart } from '@/components/BarChart';
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
  { key: 'packages', label: 'Packages' },
  { key: 'revenue', label: 'Revenue trend' },
  { key: 'therapistComparison', label: 'Therapist comparison' },
  { key: 'serviceUsage', label: 'Frequently used services' },
  { key: 'modalityUsage', label: 'Treatment modalities' },
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
}: {
  label: string;
  value: ReactNode;
  trendPct?: number | null;
  trendLabel?: string;
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
      {trendLabel && <div className="mt-0.5 text-[11px] text-[var(--muted)]">{trendLabel}</div>}
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
  visitCount: 0,
  uniquePatients: 0,
};

/** Buckets a list of counts-with-a-number into fixed ranges for a small
 *  histogram — the shape both "single-visit patients" and "regulars" need
 *  (how overdue, how many visits), just with different bucket edges. */
function bucketCounts(values: number[], edges: { max: number; label: string }[]): number[] {
  const counts = new Array(edges.length).fill(0) as number[];
  for (const v of values) {
    const idx = edges.findIndex((e) => v <= e.max);
    counts[idx === -1 ? edges.length - 1 : idx]++;
  }
  return counts;
}

export function DashboardPage() {
  const clinic = useClinic();
  const scope = useWorkspaceScope();
  const labels = clinicShareLabels(clinic);
  const { hospitalSplit } = clinicBillingConfig(clinic);
  const revenueLabel = hospitalSplit ? `Post-Tax ${labels.own}` : 'Revenue';

  // Revenue trend period — the KPI strip's "this/last month" figures only
  // ever read the final two entries, which stay the same regardless of how
  // far back the window extends, so one query serves both the KPI strip and
  // the trend chart below.
  const [trendPeriod, setTrendPeriod] = useState<'6m' | '1y' | 'fy'>('6m');
  const currentFy = fiscalYearOf(new Date(), clinic.fyStartMonth);
  const trendMonthsArg = useMemo((): number | FyMonth[] => {
    if (trendPeriod === '1y') return 12;
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
    trendPeriod === '6m' ? 'last 6 months' : trendPeriod === '1y' ? 'last 12 months' : `FY ${currentFy.label}`;

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
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);
  const serviceUsage = useLiveQuery(
    () => dashboardService.serviceUsage(clinic.id, { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }, scope.scopeTherapistId),
    [clinic.id, scope.scopeTherapistId]
  );
  const modalityUsage = useLiveQuery(
    () => (clinic.clinicalDocsEnabled ? dashboardService.modalityUsage(clinic.id) : undefined),
    [clinic.id, clinic.clinicalDocsEnabled]
  );

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
  const revenueRow = (report: MonthlyReport | undefined) => {
    if (!report) return null;
    const row = scope.isClinicWideView ? report.total : myMonthRow(report.rows);
    return hospitalSplit ? row.postTaxPaise : row.billPaise;
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

  const packagesInScope = useMemo(
    () =>
      scope.isClinicWideView
        ? (openPackages ?? [])
        : (openPackages ?? []).filter((p) => p.startedByTherapistId === scope.myTherapistId),
    [openPackages, scope.isClinicWideView, scope.myTherapistId]
  );
  const [pkgStatusFilter, setPkgStatusFilter] = useState<'open' | 'stale' | 'all'>('open');
  const filteredPackages = useMemo(
    () => (pkgStatusFilter === 'all' ? packagesInScope : packagesInScope.filter((p) => p.stale === (pkgStatusFilter === 'stale'))),
    [packagesInScope, pkgStatusFilter]
  );

  const singleVisitBuckets = useMemo(
    () =>
      bucketCounts((singleVisitPatients ?? []).map((p) => p.daysSince), [
        { max: 30, label: '15–30d' },
        { max: 60, label: '31–60d' },
        { max: Infinity, label: '60d+' },
      ]),
    [singleVisitPatients]
  );
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
        />
        <KpiCard
          label="Avg charge/session"
          value={avgChargePerSession != null ? formatINR(avgChargePerSession) : '—'}
          trendLabel="clinic-wide, this month"
        />
        <KpiCard
          label={scope.isClinicWideView ? 'Repeat visits (30d)' : 'My repeat visits (30d)'}
          value={repeatVisitsThisMonth?.ratePct != null ? `${repeatVisitsThisMonth.ratePct}%` : '—'}
          trendLabel={
            repeatVisitsThisMonth
              ? `${repeatVisitsThisMonth.repeatCount} of ${repeatVisitsThisMonth.totalVisits} visits`
              : undefined
          }
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
        />
        <KpiCard
          label={scope.isClinicWideView ? 'Packages this month' : 'My packages this month'}
          value={newPatientsThisMonth?.newPackages ?? '—'}
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
              <p className="mb-3 text-xs text-[var(--muted)]">
                Exactly one visit on record, more than 14 days ago — worth a call to find out why, or a
                reminder to book again.
              </p>
              {singleVisitPatients === undefined ? null : singleVisitPatients.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--muted)]">No lapsed single-visit patients right now.</p>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-4">
                    <StatTile label="Total" value={singleVisitPatients.length} />
                    <div className="min-w-0 flex-1">
                      <BarChart
                        categories={['15–30d', '31–60d', '60d+']}
                        series={[{ label: 'Patients', color: SERIES_COLORS[0], values: singleVisitBuckets }]}
                        height={140}
                      />
                    </div>
                  </div>
                  <ul className="flex flex-wrap gap-1.5">
                    {singleVisitPatients.slice(0, 20).map((p) => (
                      <li key={p.patientId}>
                        <Link
                          to="/ledger"
                          search={{ patientId: p.patientId }}
                          className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--ink)] hover:bg-[var(--paper)]"
                          title={`${p.serviceName} — last seen ${formatDateDMY(p.visitDate)}, ${p.daysSince}d ago`}
                        >
                          {p.patientName} <span className="text-[var(--muted)]">{p.mrno}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </SectionCard>
          </div>

          <div
            ref={(el) => {
              if (el) sectionRefs.current.set('packages', el);
              else sectionRefs.current.delete('packages');
            }}
            className="scroll-mt-28 md:scroll-mt-20"
          >
            <SectionCard title={scope.isClinicWideView ? 'Packages' : 'My packages'}>
              <p className="mb-3 text-xs text-[var(--muted)]">
                Every patient on a package{scope.isClinicWideView ? '' : " you've started"} — who's still owed
                sessions, and whose package has gone quiet.
              </p>
              <div className="mb-3 flex items-center gap-1.5">
                {(
                  [
                    { key: 'open', label: 'Open' },
                    { key: 'stale', label: 'Stale' },
                    { key: 'all', label: 'All' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setPkgStatusFilter(opt.key)}
                    className="rounded-full border px-3 py-1 text-xs font-medium"
                    style={{
                      background: pkgStatusFilter === opt.key ? 'var(--teal-light)' : 'var(--surface)',
                      borderColor: pkgStatusFilter === opt.key ? 'transparent' : 'var(--border)',
                      color: pkgStatusFilter === opt.key ? 'var(--teal)' : 'var(--muted)',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
                <span className="ml-1 text-xs text-[var(--muted)]">
                  {filteredPackages.length} package{filteredPackages.length === 1 ? '' : 's'}
                </span>
              </div>
              {filteredPackages.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--muted)]">No packages match this filter.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-[var(--border)]">
                    <thead className="bg-[var(--paper)]">
                      <tr>
                        <th className={th}>Patient</th>
                        <th className={th}>Package</th>
                        <th className={th}>Therapist</th>
                        <th className={thNum}>Sessions</th>
                        <th className={th}>Last visit</th>
                        <th className={th}>Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {filteredPackages.map((p) => (
                        <tr key={p.packageGroupId}>
                          <td className={td}>
                            {p.patientName} <span className="text-[var(--muted)]">{p.mrno}</span>
                          </td>
                          <td className={td}>{p.serviceName}</td>
                          <td className={td}>{p.startedByTherapistName}</td>
                          <td className={tdNum}>
                            <span className="inline-flex items-center gap-1.5">
                              <PackageThread sessionIndex={p.sessionsLogged} packageTotal={p.packageTotal} />
                              {p.sessionsLogged} / {p.packageTotal}
                            </span>
                          </td>
                          <td className={td}>{p.daysSinceLastVisit}d ago</td>
                          <td className={td}>
                            <Pill tone={p.stale ? 'amber' : 'green'}>{p.stale ? 'Stale' : 'Open'}</Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
                    { key: '1y', label: '1 year' },
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
                <div className="space-y-4">
                  <div>
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      {revenueLabel}
                    </h3>
                    <BarChart
                      categories={categories}
                      series={[
                        {
                          label: revenueLabel,
                          color: SERIES_COLORS[0],
                          values: scope.isClinicWideView
                            ? trend.map((r) => (hospitalSplit ? r.total.postTaxPaise : r.total.billPaise))
                            : trend.map((r) => {
                                const row = myMonthRow(r.rows);
                                return hospitalSplit ? row.postTaxPaise : row.billPaise;
                              }),
                        },
                      ]}
                      formatValue={formatINR}
                    />
                  </div>
                  {/* Alongside revenue, not folded into the same chart — visit
                      count and rupee totals are wildly different scales, and
                      seeing both shapes side by side is what actually answers
                      "did revenue move because of price or volume". */}
                  <div>
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Visits</h3>
                    <BarChart
                      categories={categories}
                      series={[
                        {
                          label: 'Visits',
                          color: SERIES_COLORS[1],
                          values: scope.isClinicWideView
                            ? trend.map((r) => r.total.visitCount)
                            : trend.map((r) => myMonthRow(r.rows).visitCount),
                        },
                      ]}
                    />
                  </div>
                </div>
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
                  {serviceUsage.slice(0, 8).map((s) => (
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
              if (el) sectionRefs.current.set('referralSources', el);
              else sectionRefs.current.delete('referralSources');
            }}
            className="scroll-mt-28 md:scroll-mt-20"
          >
            <SectionCard title="Referral sources">
              <p className="mb-4 text-xs text-[var(--muted)]">
                Where your patients are coming from, and how much revenue each source has actually brought in.
              </p>
              {referralSources && referralSources.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <PieChart
                    data={referralSources.map((r) => ({
                      label: r.source,
                      value: r.count,
                    }))}
                  />
                  <ul className="space-y-2">
                    {referralSources.map((r) => (
                      <li key={r.source} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-[var(--ink)]">{r.source}</span>
                        <span className="flex items-center gap-3">
                          <span className="font-num text-[var(--muted)]">{r.count} visits</span>
                          <span className="font-num text-[var(--muted)]" title="Total revenue from this source">
                            {formatINR(r.revenuePaise)}
                          </span>
                          <span className="font-num text-[var(--muted)]" title="Average revenue per visit from this source">
                            avg {formatINR(r.avgRevenuePaise)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
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
