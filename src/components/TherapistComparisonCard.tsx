import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService, repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { useEntitlements } from '@/app/useEntitlements';
import { clinicBillingConfig, clinicShareLabels } from '@/domain/types';
import { formatINR } from '@/domain/money';
import { monthName } from '@/domain/fiscalYear';
import { SectionCard, th, thNum, td, tdNum } from '@/components/ui';
import { SERIES_COLORS } from '@/components/chartColors';
import { VisitsRevenueTrendChart } from '@/components/VisitsRevenueTrendChart';
import { useCompactChart } from '@/components/useCompactChart';

function TableColumnHead({ title, detail }: { title: string; detail: string }) {
  return (
    <th className={thNum}>
      <div>{title}</div>
      <div className="mt-0.5 text-[9px] font-normal normal-case tracking-normal text-[var(--muted)]">{detail}</div>
    </th>
  );
}

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
export function TherapistComparisonCard() {
  const clinic = useClinic();
  const scope = useWorkspaceScope();
  const entitlements = useEntitlements(clinic.id);
  const compact = useCompactChart();
  const showComparison =
    clinic.showTherapistComparison && !scope.isFrontDesk && entitlements.can('revenueSplit');
  const { partnerSplit } = clinicBillingConfig(clinic);
  const labels = clinicShareLabels(clinic);
  const showPostTax = partnerSplit;
  const revenueLabel = showPostTax ? `Post-Tax ${labels.own}` : 'Revenue generated';

  const trend = useLiveQuery(
    () => (showComparison ? dashboardService.revenueTrend(clinic.id) : undefined),
    [clinic.id, showComparison]
  );
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

  const [chartMonthIndex, setChartMonthIndex] = useState(0);
  useEffect(() => {
    if (trend?.length) setChartMonthIndex(trend.length - 1);
  }, [trend?.length]);

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

  const currentMonthRow = trend?.[trend.length - 1];

  const therapistLiveStats = useLiveQuery(
    async () => {
      if (!showComparison || !currentMonthRow || !therapists?.length) return undefined;
      const asOf = new Date(currentMonthRow.month.year, currentMonthRow.month.month - 1, 15);
      return Promise.all(
        therapists.map(async (t) => {
          const [rep, counts] = await Promise.all([
            dashboardService.repeatVisits(clinic.id, currentMonthRow.month, t.id),
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
    [clinic.id, showComparison, currentMonthRow?.month.year, currentMonthRow?.month.month, therapists]
  );

  const statsByName = useMemo(
    () => new Map((therapistLiveStats ?? []).map((s) => [s.name, s])),
    [therapistLiveStats]
  );

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
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">This month</p>
          <h3 className="font-display text-sm font-semibold text-[var(--ink)]">Live totals</h3>
          <div className="mt-3 overflow-x-auto overscroll-x-contain rounded-lg border border-[var(--border)]">
            <table className="min-w-full divide-y divide-[var(--border)]">
              <thead className="bg-[var(--paper)]">
                <tr>
                  <th
                    className={`${th} sticky left-0 z-[1] bg-[var(--paper)] shadow-[2px_0_4px_rgba(0,0,0,0.04)]`}
                  >
                    <div>Therapist</div>
                    <div className="mt-0.5 text-[9px] font-normal normal-case tracking-normal text-[var(--muted)]">
                      Team member
                    </div>
                  </th>
                  <TableColumnHead title="Bill amount" detail="Total billed this month" />
                  {showPostTax && (
                    <TableColumnHead title={`Post tax ${labels.own}`} detail="Clinic share after TDS" />
                  )}
                  <TableColumnHead title="Net" detail="After splits & package attribution" />
                  <TableColumnHead title="Visits" detail="Sessions this month" />
                  <TableColumnHead
                    title="Retention"
                    detail="Repeat visits within 30 days, % of visits"
                  />
                  <TableColumnHead title="Packages" detail="New packages started this month" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {therapistNames.map((name) => {
                  const row = currentMonthRow?.rows.find((r) => r.therapistName === name);
                  const live = statsByName.get(name);
                  return (
                    <tr key={name}>
                      <td
                        className={`${td} sticky left-0 z-[1] bg-[var(--surface)] shadow-[2px_0_4px_rgba(0,0,0,0.04)]`}
                      >
                        {name}
                      </td>
                      <td className={tdNum}>{formatINR(row?.billPaise ?? 0)}</td>
                      {showPostTax && <td className={tdNum}>{formatINR(row?.postTaxPaise ?? 0)}</td>}
                      <td className={tdNum}>{formatINR(row?.netPostTaxPaise ?? 0)}</td>
                      <td className={tdNum}>{row?.visitCount ?? 0}</td>
                      <td className={tdNum}>
                        {live?.retentionPct != null ? `${live.retentionPct}%` : '—'}
                      </td>
                      <td className={tdNum}>{live?.newPackages ?? 0}</td>
                    </tr>
                  );
                })}
                {currentMonthRow && (
                  <tr className="bg-[var(--paper)] font-semibold">
                    <td
                      className={`${td} sticky left-0 z-[1] bg-[var(--paper)] shadow-[2px_0_4px_rgba(0,0,0,0.04)]`}
                    >
                      Total
                    </td>
                    <td className={tdNum}>{formatINR(currentMonthRow.total.billPaise)}</td>
                    {showPostTax && (
                      <td className={tdNum}>{formatINR(currentMonthRow.total.postTaxPaise)}</td>
                    )}
                    <td className={tdNum}>{formatINR(currentMonthRow.total.netPostTaxPaise)}</td>
                    <td className={tdNum}>{currentMonthRow.total.visitCount}</td>
                    <td className={tdNum}>—</td>
                    <td className={tdNum}>
                      {(therapistLiveStats ?? []).reduce((s, t) => s + t.newPackages, 0)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
