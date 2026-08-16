import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService, repos } from '@/services';
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
  // Packages don't come back keyed by therapist name the way trend's rows
  // do (openPackages only has startedByTherapistId, a real id) — fetch the
  // roster once to resolve it, same join every other packages-by-therapist
  // spot in the app already needs.
  const openPackages = useLiveQuery(
    () => (clinic.showTherapistComparison && !scope.isFrontDesk ? dashboardService.openPackages(clinic.id) : undefined),
    [clinic.id, clinic.showTherapistComparison, scope.isFrontDesk]
  );
  const therapists = useLiveQuery(
    () => (clinic.showTherapistComparison && !scope.isFrontDesk ? repos.therapists.list(clinic.id, true) : undefined),
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

  const nameByTherapistId = new Map((therapists ?? []).map((t) => [t.id, t.name]));
  const openPackageCountByName = new Map<string, number>();
  for (const p of openPackages ?? []) {
    const name = nameByTherapistId.get(p.startedByTherapistId);
    if (!name) continue;
    openPackageCountByName.set(name, (openPackageCountByName.get(name) ?? 0) + 1);
  }

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
                values: trend.map((r) => {
                  const row = r.rows.find((row) => row.therapistName === name);
                  return (hospitalSplit ? row?.postTaxPaise : row?.billPaise) ?? 0;
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
    </SectionCard>
  );
}
