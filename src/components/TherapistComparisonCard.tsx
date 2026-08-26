import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService, repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { useEntitlements } from '@/app/useEntitlements';
import { clinicBillingConfig, clinicShareLabels } from '@/domain/types';
import { formatINR } from '@/domain/money';
import { monthName } from '@/domain/fiscalYear';
import { SectionCard, th, thNum, td, tdNum } from '@/components/ui';
import { BarChart } from '@/components/BarChart';
import { SERIES_COLORS } from '@/components/chartColors';

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
  // Clinic/Clinic+ feature (Part 3 of the tier plan) — the clinic-wide
  // opt-in still applies on top, but a Lite/Solo clinic doesn't get this
  // regardless of whether the toggle happens to be on.
  const showComparison = clinic.showTherapistComparison && !scope.isFrontDesk && entitlements.can('revenueSplit');
  // Post-Tax BM adjusted for same-visit splits and automatic package-session
  // attribution (reportService's netPostTaxPaise) — genuinely post-tax for a
  // hospital-split clinic, and equal to the plain net bill for a simple one
  // (postTaxPaise === actualBillPaise there), so the same mode-aware label
  // ReportsOverviewPage's KPI strip uses applies here too.
  const { hospitalSplit } = clinicBillingConfig(clinic);
  const labels = clinicShareLabels(clinic);
  const revenueLabel = hospitalSplit ? `Post-Tax ${labels.own}` : 'Revenue generated';

  const trend = useLiveQuery(
    () => (showComparison ? dashboardService.revenueTrend(clinic.id) : undefined),
    [clinic.id, showComparison]
  );
  // Packages don't come back keyed by therapist name the way trend's rows
  // do (openPackages only has startedByTherapistId, a real id) — fetch the
  // roster once to resolve it, same join every other packages-by-therapist
  // spot in the app already needs.
  const openPackages = useLiveQuery(
    () => (showComparison ? dashboardService.openPackages(clinic.id) : undefined),
    [clinic.id, showComparison]
  );
  const therapists = useLiveQuery(
    () => (showComparison ? repos.therapists.list(clinic.id, true) : undefined),
    [clinic.id, showComparison]
  );

  const categories = useMemo(
    () => (trend ?? []).map((r) => `${monthName(r.month.month).slice(0, 3)} '${String(r.month.year).slice(2)}`),
    [trend]
  );
  const therapistNames = useMemo(
    () => [...new Set((trend ?? []).flatMap((r) => r.rows.map((row) => row.therapistName)))].sort(),
    [trend]
  );
  // A trend line built mostly from months with zero activity (a clinic only
  // a few weeks old, or a therapist who just joined) reads as a dramatic
  // spike rather than what it actually is — not enough history yet.
  const hasEnoughTrendHistory = useMemo(
    () => (trend ?? []).filter((r) => r.total.visitCount > 0).length >= 2,
    [trend]
  );

  const nameByTherapistId = new Map((therapists ?? []).map((t) => [t.id, t.name]));
  const openPackageCountByName = new Map<string, number>();
  for (const p of openPackages ?? []) {
    const name = nameByTherapistId.get(p.startedByTherapistId);
    if (!name) continue;
    openPackageCountByName.set(name, (openPackageCountByName.get(name) ?? 0) + 1);
  }

  // trend's last entry is always the current calendar month, and useLiveQuery
  // re-runs it the moment a visit is logged — so this table stays real-time
  // even while the charts above it are gated behind two months of history.
  const currentMonthRow = trend?.[trend.length - 1];

  if (!showComparison) return null;

  return (
    <SectionCard title="Therapist comparison">
      {trend && !hasEnoughTrendHistory && (
        <p className="py-4 text-center text-sm text-[var(--muted)]">
          Trend charts need at least two months of visits to be meaningful — the table below already
          reflects this month.
        </p>
      )}
      {trend && hasEnoughTrendHistory && therapistNames.length > 0 && (
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              {revenueLabel}
            </h3>
            <BarChart
              categories={categories}
              series={therapistNames.slice(0, SERIES_COLORS.length).map((name, i) => ({
                label: name,
                color: SERIES_COLORS[i],
                values: trend.map((r) => {
                  const row = r.rows.find((row) => row.therapistName === name);
                  return row?.netPostTaxPaise ?? 0;
                }),
              }))}
              formatValue={formatINR}
            />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Visits</h3>
            <BarChart
              categories={categories}
              series={therapistNames.slice(0, SERIES_COLORS.length).map((name, i) => ({
                label: name,
                color: SERIES_COLORS[i],
                values: trend.map((r) => r.rows.find((row) => row.therapistName === name)?.visitCount ?? 0),
              }))}
            />
          </div>
          {/* One-value-per-therapist snapshot (this month, right now), not a
              6-month trend like the two above — one bar per therapist rather
              than one series per therapist. */}
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Open packages</h3>
            <BarChart
              categories={therapistNames}
              series={[
                {
                  label: 'Open packages',
                  color: SERIES_COLORS[1],
                  values: therapistNames.map((name) => openPackageCountByName.get(name) ?? 0),
                },
              ]}
            />
          </div>
        </div>
      )}
      {trend && hasEnoughTrendHistory && therapistNames.length === 0 && (
        <p className="text-sm text-[var(--muted)]">No visits in the last 6 months.</p>
      )}
      {trend && therapistNames.length > 0 && (
        <div className={hasEnoughTrendHistory ? 'mt-6' : ''}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            This month — live
          </h3>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="min-w-full divide-y divide-[var(--border)]">
              <thead className="bg-[var(--paper)]">
                <tr>
                  <th className={th}>Therapist</th>
                  <th className={thNum}>Bill Amount</th>
                  {hospitalSplit && <th className={thNum}>Post Tax {labels.own}</th>}
                  <th className={thNum}>Net</th>
                  <th className={thNum}>Visits</th>
                  <th className={thNum}>Open packages</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {therapistNames.map((name) => {
                  const row = currentMonthRow?.rows.find((r) => r.therapistName === name);
                  return (
                    <tr key={name}>
                      <td className={td}>{name}</td>
                      <td className={tdNum}>{formatINR(row?.billPaise ?? 0)}</td>
                      {hospitalSplit && <td className={tdNum}>{formatINR(row?.postTaxPaise ?? 0)}</td>}
                      <td className={tdNum}>{formatINR(row?.netPostTaxPaise ?? 0)}</td>
                      <td className={tdNum}>{row?.visitCount ?? 0}</td>
                      <td className={tdNum}>{openPackageCountByName.get(name) ?? 0}</td>
                    </tr>
                  );
                })}
                {currentMonthRow && (
                  <tr className="bg-[var(--paper)] font-semibold">
                    <td className={td}>Total</td>
                    <td className={tdNum}>{formatINR(currentMonthRow.total.billPaise)}</td>
                    {hospitalSplit && (
                      <td className={tdNum}>{formatINR(currentMonthRow.total.postTaxPaise)}</td>
                    )}
                    <td className={tdNum}>{formatINR(currentMonthRow.total.netPostTaxPaise)}</td>
                    <td className={tdNum}>{currentMonthRow.total.visitCount}</td>
                    <td className={tdNum}>
                      {[...openPackageCountByName.values()].reduce((s, n) => s + n, 0)}
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
