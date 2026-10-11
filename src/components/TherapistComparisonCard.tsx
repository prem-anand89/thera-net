import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService, repos } from '@/services';
import type { MonthlyReport } from '@/services/reportService';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { useEntitlements } from '@/app/useEntitlements';
import { clinicBillingConfig, clinicShareLabels } from '@/domain/types';
import { formatINR } from '@/domain/money';
import { monthName } from '@/domain/fiscalYear';
import { SectionCard } from '@/components/ui';
import { useTherapistUtilisation } from '@/components/useTherapistUtilisation';
import {
  TherapistComparisonTable,
  type TherapistComparisonRow,
} from '@/components/TherapistComparisonTable';
import { MonthlyRevenueChart } from '@/components/MonthlyRevenueChart';
import { MonthlyVisitsChart } from '@/components/MonthlyVisitsChart';

/**
 * Revenue and visit-count side by side, one bar series per therapist.
 * Financial aggregates are admin-only everywhere else (decision 3 in the
 * build plan) — this chart is the deliberate exception (decision 4),
 * visible to therapists too for competitive visibility, gated only by the
 * clinic-wide `showTherapistComparison` opt-in. front_desk is excluded —
 * no clinical work of their own to compare against colleagues. Renders
 * nothing when the clinic hasn't opted in, or for front_desk, so call
 * sites can drop it in without re-deriving that gate themselves.
 */
type TherapistComparisonCardProps = {
  /** Reports → Trends: parent owns period + `revenueTrend` query. */
  controlledTrend?: boolean;
  trendData?: MonthlyReport[];
  chartMonthIndex?: number;
  onChartMonthIndexChange?: (index: number) => void;
};

export function TherapistComparisonCard({
  controlledTrend = false,
  trendData,
  chartMonthIndex: chartMonthIndexProp,
  onChartMonthIndexChange,
}: TherapistComparisonCardProps = {}) {
  const clinic = useClinic();
  const scope = useWorkspaceScope();
  const entitlements = useEntitlements(clinic.id);
  const showComparison = !scope.isFrontDesk && entitlements.can('revenueSplit');
  const { partnerSplit } = clinicBillingConfig(clinic);
  const labels = clinicShareLabels(clinic);
  const showPostTax = partnerSplit;
  const revenueLabel = showPostTax ? `Post-Tax ${labels.own}` : 'Revenue generated';

  const trendQuery = useLiveQuery(
    () => (showComparison && !controlledTrend ? dashboardService.revenueTrend(clinic.id) : undefined),
    [clinic.id, showComparison, controlledTrend]
  );
  const trend = controlledTrend ? trendData : (trendData ?? trendQuery);
  const therapists = useLiveQuery(
    () => (showComparison ? repos.therapists.list(clinic.id, true) : undefined),
    [clinic.id, showComparison]
  );

  const categories = useMemo(
    () =>
      (trend ?? []).map(
        (r) => `${monthName(r.month.month).slice(0, 3)} '${String(r.month.year).slice(2)}`
      ),
    [trend]
  );
  const therapistNames = useMemo(
    () => [...new Set((trend ?? []).flatMap((r) => r.rows.map((row) => row.therapistName)))].sort(),
    [trend]
  );
  const hasEnoughTrendHistory = useMemo(
    () => (trend ?? []).filter((r) => r.total.visitCount > 0).length >= 2,
    [trend]
  );

  const [viewMode, setViewMode] = useState<'comparison' | 'individual'>('comparison');
  const [selectedTherapistName, setSelectedTherapistName] = useState<string>('');

  useEffect(() => {
    if (!selectedTherapistName && therapistNames.length > 0) {
      setSelectedTherapistName(therapistNames[0]);
    }
  }, [selectedTherapistName, therapistNames]);

  const activeTherapistName = selectedTherapistName || therapistNames[0] || '';

  const [chartMonthIndexLocal, setChartMonthIndexLocal] = useState(0);
  const chartMonthIndex = chartMonthIndexProp ?? chartMonthIndexLocal;
  const setChartMonthIndex = onChartMonthIndexChange ?? setChartMonthIndexLocal;
  useEffect(() => {
    if (controlledTrend) return;
    if (trend?.length) setChartMonthIndexLocal(trend.length - 1);
  }, [trend?.length, controlledTrend]);

  const chartMonth = trend?.[chartMonthIndex];
  const chartMonthIsInProgress = useMemo(() => {
    if (!chartMonth) return false;
    const now = new Date();
    return chartMonth.month.year === now.getFullYear() && chartMonth.month.month === now.getMonth() + 1;
  }, [chartMonth]);

  const therapistVisitCounts = useMemo(
    () =>
      therapistNames.map(
        (name) => chartMonth?.rows.find((r) => r.therapistName === name)?.visitCount ?? 0
      ),
    [therapistNames, chartMonth]
  );

  const therapistRevenuePaise = useMemo(
    () =>
      therapistNames.map(
        (name) => chartMonth?.rows.find((r) => r.therapistName === name)?.netPostTaxPaise ?? 0
      ),
    [therapistNames, chartMonth]
  );

  const therapistLiveStats = useLiveQuery(
    async () => {
      if (!showComparison || !chartMonth || !therapists?.length) return undefined;
      const asOf = new Date(chartMonth.month.year, chartMonth.month.month - 1, 15);
      return Promise.all(
        therapists.map(async (t) => {
          const [rep, counts] = await Promise.all([
            dashboardService.repeatVisits(clinic.id, chartMonth.month, t.id),
            dashboardService.monthlyNewCounts(clinic.id, asOf, t.id),
          ]);
          return {
            therapistId: t.id,
            name: t.name,
            retentionPct: rep.ratePct,
            newPackages: counts.newPackages,
          };
        })
      );
    },
    [clinic.id, showComparison, chartMonth?.month.year, chartMonth?.month.month, therapists]
  );

  const utilisationById = useTherapistUtilisation(chartMonth?.month, therapists, showComparison);

  const statsByName = useMemo(
    () => new Map((therapistLiveStats ?? []).map((s) => [s.name, s])),
    [therapistLiveStats]
  );

  const comparisonRows = useMemo((): TherapistComparisonRow[] => {
    return therapistNames.map((name) => {
      const row = chartMonth?.rows.find((r) => r.therapistName === name);
      const live = statsByName.get(name);
      const util = live ? utilisationById?.get(live.therapistId) : undefined;
      return {
        therapistName: name,
        billPaise: row?.billPaise ?? 0,
        postTaxPaise: row?.postTaxPaise ?? 0,
        netPostTaxPaise: row?.netPostTaxPaise ?? 0,
        visitCount: row?.visitCount ?? 0,
        retentionPct: live?.retentionPct ?? null,
        newPackages: live?.newPackages ?? 0,
        utilisation: util ? util.ratio : undefined,
        utilisationClinicHours: util?.usesClinicHours,
      };
    });
  }, [therapistNames, chartMonth, statsByName, utilisationById]);

  const comparisonTotal = useMemo((): TherapistComparisonRow | undefined => {
    if (!chartMonth) return undefined;
    let totalWorked = 0;
    let totalAvailable = 0;
    if (utilisationById) {
      for (const u of utilisationById.values()) {
        totalWorked += u.workedMinutes ?? 0;
        totalAvailable += u.availableMinutes ?? 0;
      }
    }
    const clinicUtilRatio = totalAvailable > 0 ? totalWorked / totalAvailable : null;

    return {
      therapistName: 'Total',
      billPaise: chartMonth.total.billPaise,
      postTaxPaise: chartMonth.total.postTaxPaise,
      netPostTaxPaise: chartMonth.total.netPostTaxPaise,
      visitCount: chartMonth.total.visitCount,
      retentionPct: null,
      newPackages: (therapistLiveStats ?? []).reduce((s, t) => s + t.newPackages, 0),
      utilisation: clinicUtilRatio,
    };
  }, [chartMonth, therapistLiveStats, utilisationById]);

  const totalMonthRevenue = useMemo(() => {
    return (chartMonth?.rows ?? []).reduce((sum, r) => sum + (r.netPostTaxPaise ?? 0), 0);
  }, [chartMonth]);

  const totalMonthVisits = useMemo(() => {
    return (chartMonth?.rows ?? []).reduce((sum, r) => sum + (r.visitCount ?? 0), 0);
  }, [chartMonth]);

  const therapistRevenueRanking = useMemo(() => {
    return therapistNames
      .map((name, i) => {
        const revenue = therapistRevenuePaise[i] ?? 0;
        const sharePct = totalMonthRevenue > 0 ? Math.round((revenue / totalMonthRevenue) * 100) : 0;
        const barPct = totalMonthRevenue > 0 ? Math.min(100, Math.max(revenue > 0 ? 2 : 0, sharePct)) : 0;
        return { name, revenue, sharePct, barPct };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [therapistNames, therapistRevenuePaise, totalMonthRevenue]);

  const therapistVisitRanking = useMemo(() => {
    return therapistNames
      .map((name, i) => {
        const visits = therapistVisitCounts[i] ?? 0;
        const sharePct = totalMonthVisits > 0 ? Math.round((visits / totalMonthVisits) * 100) : 0;
        const barPct = totalMonthVisits > 0 ? Math.min(100, Math.max(visits > 0 ? 2 : 0, sharePct)) : 0;
        return { name, visits, sharePct, barPct };
      })
      .sort((a, b) => b.visits - a.visits);
  }, [therapistNames, therapistVisitCounts, totalMonthVisits]);

  // Single Therapist Trend data across all period months
  const individualRevenuePaise = useMemo(() => {
    return (trend ?? []).map((m) => {
      const row = m.rows.find((r) => r.therapistName === activeTherapistName);
      return row?.netPostTaxPaise ?? 0;
    });
  }, [trend, activeTherapistName]);

  const individualVisitCounts = useMemo(() => {
    return (trend ?? []).map((m) => {
      const row = m.rows.find((r) => r.therapistName === activeTherapistName);
      return row?.visitCount ?? 0;
    });
  }, [trend, activeTherapistName]);

  const individualTotalRevenue = useMemo(() => {
    return individualRevenuePaise.reduce((sum, v) => sum + v, 0);
  }, [individualRevenuePaise]);

  const individualTotalVisits = useMemo(() => {
    return individualVisitCounts.reduce((sum, v) => sum + v, 0);
  }, [individualVisitCounts]);

  const [individualIndex, setIndividualIndex] = useState<number | null>(null);

  if (!showComparison) return null;

  return (
    <SectionCard title="Therapist comparison">
      {trend && !hasEnoughTrendHistory && (
        <p className="py-4 text-center text-sm text-[var(--muted)]">
          Trend charts need at least two months of visits to be meaningful — the table below already
          reflects this month.
        </p>
      )}

      {trend && therapistNames.length > 0 && (
        <div className="border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                {viewMode === 'comparison' ? 'Comparative attribution' : 'Individual trend'}
              </p>
              <h3 className="font-display text-sm font-semibold text-[var(--ink)]">
                {viewMode === 'comparison'
                  ? 'Performance comparison per therapist'
                  : `${activeTherapistName} — Performance across period`}
              </h3>
            </div>

            {/* View Mode Switcher Toggle */}
            <div className="inline-flex shrink-0 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('comparison')}
                className={`rounded-md px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${
                  viewMode === 'comparison'
                    ? 'bg-[var(--surface)] text-[var(--ink)] font-semibold shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                All Therapists
              </button>
              <button
                type="button"
                onClick={() => setViewMode('individual')}
                className={`rounded-md px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${
                  viewMode === 'individual'
                    ? 'bg-[var(--surface)] text-[var(--ink)] font-semibold shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                Single Therapist Trend
              </button>
            </div>
          </div>

          {/* VIEW MODE 1: Comparative Ranking for Selected Month */}
          {viewMode === 'comparison' && (
            <div className="mt-4">
              {categories.length > 1 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
                  <span className="text-xs text-[var(--muted)] mr-1">Month:</span>
                  {categories.map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setChartMonthIndex(i)}
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${
                        chartMonthIndex === i
                          ? 'bg-[var(--teal-light)] text-[var(--teal-strong)] font-semibold ring-1 ring-[var(--teal)]/30'
                          : 'bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)] hover:bg-[var(--paper)]'
                      }`}
                    >
                      {label}
                      {i === categories.length - 1 && chartMonthIsInProgress && i === chartMonthIndex ? ' · live' : ''}
                    </button>
                  ))}
                </div>
              )}

              {/* Two Side-by-Side Comparative Ranking Cards */}
              <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Revenue Ranking Card */}
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xs">
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      {revenueLabel}
                    </span>
                    <span className="font-num text-xs font-semibold text-[var(--ink)]">
                      Total: {formatINR(totalMonthRevenue)}
                    </span>
                  </div>
                  <div className="space-y-3.5">
                    {therapistRevenueRanking.map((item) => (
                      <div key={item.name} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-[var(--ink)]">{item.name}</span>
                          <div className="flex items-baseline gap-2">
                            <span className="font-num font-semibold text-[var(--ink)]">{formatINR(item.revenue)}</span>
                            <span className="font-num text-[11px] font-medium text-[var(--muted)]">
                              {item.sharePct}% of clinic
                            </span>
                          </div>
                        </div>
                        <div className="h-3.5 w-full overflow-hidden rounded-full bg-[var(--paper)]">
                          <div
                            className="h-full rounded-full bg-[var(--teal)] transition-all"
                            style={{ width: `${item.barPct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Visits Ranking Card */}
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xs">
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      Patient Visits
                    </span>
                    <span className="font-num text-xs font-semibold text-[var(--ink)]">
                      Total: {totalMonthVisits} visits
                    </span>
                  </div>
                  <div className="space-y-3.5">
                    {therapistVisitRanking.map((item) => (
                      <div key={item.name} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-[var(--ink)]">{item.name}</span>
                          <div className="flex items-baseline gap-2">
                            <span className="font-num font-semibold text-[var(--ink)]">{item.visits} visits</span>
                            <span className="font-num text-[11px] font-medium text-[var(--muted)]">
                              {item.sharePct}% of clinic
                            </span>
                          </div>
                        </div>
                        <div className="h-3.5 w-full overflow-hidden rounded-full bg-[var(--paper)]">
                          <div
                            className="h-full rounded-full bg-[#d97706] transition-all"
                            style={{ width: `${item.barPct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VIEW MODE 2: Single Therapist Trend over entire period */}
          {viewMode === 'individual' && (
            <div className="mt-4 space-y-4">
              {/* Therapist Selector Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
                <span className="text-xs text-[var(--muted)] mr-1">Practitioner:</span>
                {therapistNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setSelectedTherapistName(name)}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${
                      activeTherapistName === name
                        ? 'bg-[var(--teal-light)] text-[var(--teal-strong)] font-semibold ring-1 ring-[var(--teal)]/30'
                        : 'bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)] hover:bg-[var(--paper)]'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>

              {/* Individual Period Totals Header */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--paper)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <span className="text-[var(--muted)]">Period Total for </span>
                  <span className="font-semibold text-[var(--ink)]">{activeTherapistName}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span>
                    Revenue: <strong className="font-num text-[var(--ink)]">{formatINR(individualTotalRevenue)}</strong>
                  </span>
                  <span>
                    Visits: <strong className="font-num text-[var(--ink)]">{individualTotalVisits}</strong>
                  </span>
                </div>
              </div>

              {/* Side-by-side Revenue and Visits Charts for Single Therapist */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <MonthlyRevenueChart
                  categories={categories}
                  revenuePaise={individualRevenuePaise}
                  formatRevenue={formatINR}
                  selectedIndex={individualIndex}
                  onSelectIndex={setIndividualIndex}
                />
                <MonthlyVisitsChart
                  categories={categories}
                  visitCounts={individualVisitCounts}
                  selectedIndex={individualIndex}
                  onSelectIndex={setIndividualIndex}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {trend && therapistNames.length === 0 && (
        <p className="text-sm text-[var(--muted)]">No visits in the last 6 months.</p>
      )}

      {trend && therapistNames.length > 0 && viewMode === 'comparison' && (
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            {chartMonth
              ? `${monthName(chartMonth.month.month)} ${chartMonth.month.year}`
              : 'Selected month'}
          </p>
          <h3 className="font-display text-sm font-semibold text-[var(--ink)]">Totals</h3>
          <TherapistComparisonTable
            rows={comparisonRows}
            total={comparisonTotal}
            showPostTax={showPostTax}
            ownLabel={labels.own}
          />
        </div>
      )}
    </SectionCard>
  );
}
