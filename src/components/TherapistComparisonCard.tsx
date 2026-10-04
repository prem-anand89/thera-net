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
import { SERIES_COLORS } from '@/components/chartColors';
import { VisitsRevenueTrendChart } from '@/components/VisitsRevenueTrendChart';
import { useCompactChart } from '@/components/useCompactChart';
import {
  TherapistComparisonTable,
  type TherapistComparisonRow,
} from '@/components/TherapistComparisonTable';

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
  const compact = useCompactChart();
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

  const therapistChartCategories = useMemo(
    () =>
      therapistNames.map((name) => (compact && name.length > 10 ? `${name.slice(0, 9)}…` : name)),
    [therapistNames, compact]
  );

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

  const statsByName = useMemo(
    () => new Map((therapistLiveStats ?? []).map((s) => [s.name, s])),
    [therapistLiveStats]
  );

  const comparisonRows = useMemo((): TherapistComparisonRow[] => {
    return therapistNames.map((name) => {
      const row = chartMonth?.rows.find((r) => r.therapistName === name);
      const live = statsByName.get(name);
      return {
        therapistName: name,
        billPaise: row?.billPaise ?? 0,
        postTaxPaise: row?.postTaxPaise ?? 0,
        netPostTaxPaise: row?.netPostTaxPaise ?? 0,
        visitCount: row?.visitCount ?? 0,
        retentionPct: live?.retentionPct ?? null,
        newPackages: live?.newPackages ?? 0,
      };
    });
  }, [therapistNames, chartMonth, statsByName]);

  const comparisonTotal = useMemo((): TherapistComparisonRow | undefined => {
    if (!chartMonth) return undefined;
    return {
      therapistName: 'Total',
      billPaise: chartMonth.total.billPaise,
      postTaxPaise: chartMonth.total.postTaxPaise,
      netPostTaxPaise: chartMonth.total.netPostTaxPaise,
      visitCount: chartMonth.total.visitCount,
      retentionPct: null,
      newPackages: (therapistLiveStats ?? []).reduce((s, t) => s + t.newPackages, 0),
    };
  }, [chartMonth, therapistLiveStats]);

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
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">By month</p>
          <h3 className="font-display text-sm font-semibold text-[var(--ink)]">
            Visits and {revenueLabel.toLowerCase()} per therapist
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Same layout as the revenue trend chart — orange = visits, blue = revenue (dual scale).
          </p>
          {categories.length > 1 && (
            <div className="mb-3 mt-3 flex gap-1.5 overflow-x-auto pb-1">
              {categories.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setChartMonthIndex(i)}
                  className="shrink-0 rounded-full border px-3 py-1 text-xs font-medium"
                  style={{
                    background: chartMonthIndex === i ? 'var(--teal-light)' : 'var(--surface)',
                    borderColor: chartMonthIndex === i ? 'transparent' : 'var(--border)',
                    color: chartMonthIndex === i ? 'var(--teal)' : 'var(--muted)',
                  }}
                >
                  {label}
                  {i === categories.length - 1 && chartMonthIsInProgress && i === chartMonthIndex ? ' · live' : ''}
                </button>
              ))}
            </div>
          )}
          <VisitsRevenueTrendChart
            categories={therapistChartCategories}
            fullCategories={therapistNames}
            visitCounts={therapistVisitCounts}
            revenuePaise={therapistRevenuePaise}
            visitsColor={SERIES_COLORS[1]}
            revenueColor={SERIES_COLORS[0]}
            formatRevenue={formatINR}
            compact={compact}
            currentMonthIndices={[]}
          />
        </div>
      )}
      {trend && therapistNames.length === 0 && (
        <p className="text-sm text-[var(--muted)]">No visits in the last 6 months.</p>
      )}
      {trend && therapistNames.length > 0 && (
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
