import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { formatINR } from '@/domain/money';
import { monthName, formatDateDMY } from '@/domain/fiscalYear';
import { clinicBillingConfig, clinicShareLabels } from '@/domain/types';
import type { TherapistMonthRow } from '@/services/reportService';
import { SectionCard, StatTile, Pill } from '@/components/ui';
import { BarChart } from '@/components/BarChart';
import { PieChart } from '@/components/PieChart';
import { TherapistComparisonCard } from '@/components/TherapistComparisonCard';
import { SERIES_COLORS } from '@/components/chartColors';

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

  const trend = useLiveQuery(() => dashboardService.revenueTrend(clinic.id), [clinic.id]);
  const singleVisitPatients = useLiveQuery(
    () => dashboardService.singleVisitPatients(clinic.id),
    [clinic.id]
  );
  const recurringPatients = useLiveQuery(
    () => dashboardService.recurringPatients(clinic.id),
    [clinic.id]
  );
  const referralSources = useLiveQuery(
    () => dashboardService.referralSourceStats(clinic.id),
    [clinic.id]
  );
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);

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

  const packagesInScope = useMemo(
    () =>
      scope.isClinicWideView
        ? (openPackages ?? [])
        : (openPackages ?? []).filter((p) => p.startedByTherapistId === scope.myTherapistId),
    [openPackages, scope.isClinicWideView, scope.myTherapistId]
  );
  const packagesByService = useMemo(() => {
    const byService = new Map<string, { total: number; stale: number }>();
    for (const p of packagesInScope) {
      const entry = byService.get(p.serviceName) ?? { total: 0, stale: 0 };
      entry.total += 1;
      if (p.stale) entry.stale += 1;
      byService.set(p.serviceName, entry);
    }
    return [...byService.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [packagesInScope]);

  const singleVisitBuckets = useMemo(
    () =>
      bucketCounts((singleVisitPatients ?? []).map((p) => p.daysSince), [
        { max: 30, label: '15–30d' },
        { max: 60, label: '31–60d' },
        { max: Infinity, label: '60d+' },
      ]),
    [singleVisitPatients]
  );
  const recurringBuckets = useMemo(
    () =>
      bucketCounts((recurringPatients ?? []).map((p) => p.visitCount), [
        { max: 4, label: '3–4' },
        { max: 9, label: '5–9' },
        { max: Infinity, label: '10+' },
      ]),
    [recurringPatients]
  );

  return (
    <div className="space-y-6">
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

      <SectionCard title="Regulars — last 30 days">
        <p className="mb-3 text-xs text-[var(--muted)]">
          Three or more visits in the last month — your most engaged patients right now.
        </p>
        {recurringPatients === undefined ? null : recurringPatients.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">No one has visited 3+ times in the last 30 days yet.</p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <StatTile label="Total" value={recurringPatients.length} />
              <div className="min-w-0 flex-1">
                <BarChart
                  categories={['3–4 visits', '5–9 visits', '10+ visits']}
                  series={[{ label: 'Patients', color: SERIES_COLORS[1], values: recurringBuckets }]}
                  height={140}
                />
              </div>
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {recurringPatients.slice(0, 20).map((p) => (
                <li key={p.patientId}>
                  <Link
                    to="/ledger"
                    search={{ patientId: p.patientId }}
                    className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--ink)] hover:bg-[var(--paper)]"
                    title={`${p.visitCount} visits — last seen ${formatDateDMY(p.lastVisitOn)}`}
                  >
                    {p.patientName} <span className="text-[var(--muted)]">{p.mrno}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </SectionCard>

      <SectionCard title={scope.isClinicWideView ? 'Packages' : 'My packages'}>
        <p className="mb-3 text-xs text-[var(--muted)]">
          Open packages by service{scope.isClinicWideView ? '' : " you've started"} — how many are active,
          and how many have gone quiet.
        </p>
        {packagesInScope.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">No open packages right now.</p>
        ) : (
          <>
            <div className="mb-4 flex gap-4">
              <StatTile label="Open packages" value={packagesInScope.length} />
              <StatTile label="Stale (14d+)" value={packagesInScope.filter((p) => p.stale).length} />
            </div>
            <ul className="space-y-2">
              {packagesByService.map(([service, counts]) => (
                <li key={service} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-[var(--ink)]">{service}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-num text-[var(--muted)]">{counts.total}</span>
                    {counts.stale > 0 && <Pill tone="amber">{counts.stale} stale</Pill>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </SectionCard>

      <SectionCard title={scope.isClinicWideView ? `Revenue trend — last 6 months (${revenueLabel})` : `My revenue trend — last 6 months (${revenueLabel})`}>
        {trend && !hasEnoughTrendHistory && (
          <p className="py-8 text-center text-sm text-[var(--muted)]">
            Not enough data yet — a trend needs at least two months of visits to be meaningful.
          </p>
        )}
        {trend && hasEnoughTrendHistory && (
          <BarChart
            categories={categories}
            series={[
              {
                label: revenueLabel,
                color: SERIES_COLORS[0],
                values: scope.isClinicWideView
                  ? trend.map((r) => r.total.postTaxPaise)
                  : trend.map((r) => myMonthRow(r.rows).postTaxPaise),
              },
            ]}
            formatValue={formatINR}
          />
        )}
      </SectionCard>

      <TherapistComparisonCard />

      <SectionCard title="Referral sources">
        <p className="mb-4 text-xs text-[var(--muted)]">
          Where your patients are coming from — hospital referrals, doctor referrals, and other sources.
        </p>
        {referralSources && referralSources.length > 0 ? (
          <PieChart
            data={referralSources.map((r) => ({
              label: r.source,
              value: r.count,
            }))}
          />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--muted)]">No referral data yet.</p>
        )}
      </SectionCard>
    </div>
  );
}
