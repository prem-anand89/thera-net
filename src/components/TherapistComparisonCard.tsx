import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { formatINR } from '@/domain/money';
import { monthName } from '@/domain/fiscalYear';
import { clinicBillingConfig, clinicShareLabels } from '@/domain/types';
import { SectionCard } from '@/components/ui';
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
  const labels = clinicShareLabels(clinic);
  const { hospitalSplit } = clinicBillingConfig(clinic);
  const revenueLabel = hospitalSplit ? `Post-Tax ${labels.own}` : 'Revenue';

  const trend = useLiveQuery(
    () => (clinic.showTherapistComparison && !scope.isFrontDesk ? dashboardService.revenueTrend(clinic.id) : undefined),
    [clinic.id, clinic.showTherapistComparison, scope.isFrontDesk]
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

  if (!clinic.showTherapistComparison || scope.isFrontDesk) return null;

  return (
    <SectionCard title="Therapist comparison">
      {trend && !hasEnoughTrendHistory && (
        <p className="py-8 text-center text-sm text-[var(--muted)]">
          Not enough data yet — a comparison needs at least two months of visits to be meaningful.
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
                values: trend.map((r) => r.rows.find((row) => row.therapistName === name)?.postTaxPaise ?? 0),
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
        </div>
      )}
      {trend && hasEnoughTrendHistory && therapistNames.length === 0 && (
        <p className="text-sm text-[var(--muted)]">No visits in the last 6 months.</p>
      )}
    </SectionCard>
  );
}
