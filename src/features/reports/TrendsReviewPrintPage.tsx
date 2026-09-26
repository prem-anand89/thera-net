import { useMemo } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService, reportService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { publicLogoUrl } from '@/lib/supabase';
import { formatINR } from '@/domain/money';
import { fiscalYearOf, monthName, formatDateDM } from '@/domain/fiscalYear';
import { clinicBillingConfig, clinicShareLabels } from '@/domain/types';
import { btnPrimary, btnSecondary, StatTile } from '@/components/ui';
import { RevenueTrendPanel } from '@/components/RevenueTrendPanel';
import { SERIES_COLORS } from '@/components/chartColors';
import { VisitsRevenueTrendChart } from '@/components/VisitsRevenueTrendChart';
import {
  TherapistComparisonTable,
  type TherapistComparisonRow,
} from '@/components/TherapistComparisonTable';
import { useCompactChart } from '@/components/useCompactChart';

function DeltaCaption({ value, suffix }: { value: number | null; suffix: string }) {
  if (value == null) return null;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return (
    <div className="mt-0.5 text-[10px] font-normal text-[var(--muted)]">
      {sign}
      {Math.abs(value)}
      {suffix} vs prior month
    </div>
  );
}

/**
 * Printable trends review — snapshot month (KPIs, therapists, referrals) plus
 * the same 6-month revenue trend panels as Reports → Trends. Replaces the
 * separate monthly performance print deck.
 */
export function TrendsReviewPrintPage() {
  const clinic = useClinic();
  const compact = useCompactChart();
  const { year, month } = useSearch({ strict: false }) as { year?: number; month?: number };
  const period = {
    year: year ?? new Date().getFullYear(),
    month: month ?? new Date().getMonth() + 1,
  };
  const prevPeriod =
    period.month === 1
      ? { year: period.year - 1, month: 12 }
      : { year: period.year, month: period.month - 1 };

  const labels = clinicShareLabels(clinic);
  const { partnerSplit } = clinicBillingConfig(clinic);
  const revenueLabel = partnerSplit ? `Post-Tax ${labels.own}` : 'Revenue';
  const fy = fiscalYearOf(new Date(period.year, period.month - 1, 1), clinic.fyStartMonth);

  const report = useLiveQuery(
    () => reportService.monthly(clinic.id, period),
    [clinic.id, period.year, period.month]
  );
  const prevReport = useLiveQuery(
    () => reportService.monthly(clinic.id, prevPeriod),
    [clinic.id, prevPeriod.year, prevPeriod.month]
  );

  const trend = useLiveQuery(() => dashboardService.revenueTrend(clinic.id, 6), [clinic.id]);
  const singleVisitPatients = useLiveQuery(
    () => dashboardService.singleVisitPatients(clinic.id),
    [clinic.id]
  );
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);
  const stalePackages = useMemo(() => (openPackages ?? []).filter((p) => p.stale), [openPackages]);

  const showPostTax = useMemo(
    () => partnerSplit && (report?.total.tdsPaise ?? 0) > 0,
    [partnerSplit, report]
  );

  const therapistEngagement = useLiveQuery(async () => {
    if (!report?.rows.length) return undefined;
    const asOf = new Date(period.year, period.month - 1, 15);
    return Promise.all(
      report.rows.map(async (r) => {
        const [rep, counts] = await Promise.all([
          dashboardService.repeatVisits(clinic.id, period, r.therapistId),
          dashboardService.monthlyNewCounts(clinic.id, asOf, r.therapistId),
        ]);
        return {
          therapistId: r.therapistId,
          retentionPct: rep.ratePct,
          newPackages: counts.newPackages,
        };
      })
    );
  }, [clinic.id, period.year, period.month, report?.rows]);

  const engagementById = useMemo(
    () => new Map((therapistEngagement ?? []).map((e) => [e.therapistId, e])),
    [therapistEngagement]
  );

  const categories = useMemo(
    () =>
      (trend ?? []).map(
        (r) => `${monthName(r.month.month).slice(0, 3)} '${String(r.month.year).slice(2)}`
      ),
    [trend]
  );

  const trendRevenuePaise = useMemo(
    () =>
      (trend ?? []).map((r) => (partnerSplit ? r.total.postTaxPaise : r.total.billPaise)),
    [trend, partnerSplit]
  );
  const trendVisitCounts = useMemo(() => (trend ?? []).map((r) => r.total.visitCount), [trend]);

  const monthsWithActivity = useMemo(
    () => (trend ?? []).filter((r) => r.total.visitCount > 0).length,
    [trend]
  );
  const hasEnoughTrendHistory = monthsWithActivity >= 2;

  const trendInProgressIndices = useMemo(() => {
    const y = new Date().getFullYear();
    const m = new Date().getMonth() + 1;
    return (trend ?? [])
      .map((r, i) => (r.month.year === y && r.month.month === m ? i : -1))
      .filter((i) => i >= 0);
  }, [trend]);

  const therapistNames = (report?.rows ?? []).map((r) => r.therapistName);
  const therapistChartCategories = useMemo(
    () =>
      therapistNames.map((name) => (compact && name.length > 10 ? `${name.slice(0, 9)}…` : name)),
    [therapistNames, compact]
  );

  const comparisonRows = useMemo((): TherapistComparisonRow[] => {
    return (report?.rows ?? []).map((r) => {
      const live = engagementById.get(r.therapistId);
      return {
        therapistName: r.therapistName,
        billPaise: r.billPaise,
        postTaxPaise: r.postTaxPaise,
        netPostTaxPaise: r.netPostTaxPaise,
        visitCount: r.visitCount,
        retentionPct: live?.retentionPct ?? null,
        newPackages: live?.newPackages ?? 0,
      };
    });
  }, [report?.rows, engagementById]);

  const comparisonTotal = useMemo((): TherapistComparisonRow | undefined => {
    if (!report) return undefined;
    return {
      therapistName: 'Total',
      billPaise: report.total.billPaise,
      postTaxPaise: report.total.postTaxPaise,
      netPostTaxPaise: report.total.netPostTaxPaise,
      visitCount: report.total.visitCount,
      retentionPct: null,
      newPackages: (therapistEngagement ?? []).reduce((s, e) => s + e.newPackages, 0),
    };
  }, [report, therapistEngagement]);

  const revenueDeltaPct =
    report && prevReport && prevReport.total.netPostTaxPaise > 0
      ? Math.round(
          ((report.total.netPostTaxPaise - prevReport.total.netPostTaxPaise) /
            prevReport.total.netPostTaxPaise) *
            100
        )
      : null;
  const visitsDelta =
    report && prevReport ? report.total.visitCount - prevReport.total.visitCount : null;

  const logoUrl = useMemo(() => publicLogoUrl(clinic.logoPath), [clinic.logoPath]);
  const showTherapistBlock = clinic.showTherapistComparison && therapistNames.length > 0;

  return (
    <div className="min-h-screen bg-[var(--paper)] print:bg-[var(--surface)]">
      <style>{`@page { size: A4 portrait; margin: 10mm; }`}</style>

      <div className="no-print mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
        <Link to="/insights" className={btnSecondary}>← Back to Trends</Link>
        <button type="button" className={`${btnPrimary} ml-auto`} onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 bg-[var(--surface)] p-8 print:max-w-[190mm] print:p-0">
        <header className="flex items-start justify-between border-b border-[var(--border)] pb-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {logoUrl && (
              <img src={logoUrl} alt="" className="h-14 w-auto shrink-0 object-contain" />
            )}
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold text-[var(--ink)]">{clinic.name}</h1>
              <p className="text-xs text-[var(--muted)]">Trends review</p>
            </div>
          </div>
          <p className="shrink-0 text-sm text-[var(--muted)]">
            {monthName(period.month)} {period.year} · FY {fy.label}
          </p>
        </header>

        <section className="break-inside-avoid">
          <h2 className="mb-2 text-sm font-bold text-[var(--ink)]">This month at a glance</h2>
          <div className="flex flex-wrap gap-2">
            <StatTile
              label={revenueLabel}
              value={
                <>
                  {formatINR(report?.total.netPostTaxPaise ?? 0)}
                  <DeltaCaption value={revenueDeltaPct} suffix="%" />
                </>
              }
            />
            <StatTile
              label="Visits"
              value={
                <>
                  {report?.total.visitCount ?? 0}
                  <DeltaCaption value={visitsDelta} suffix="" />
                </>
              }
            />
            <StatTile label="Unique patients" value={report?.total.uniquePatients ?? 0} />
          </div>
        </section>

        <section className="break-inside-avoid">
          <h2 className="mb-2 text-sm font-bold text-[var(--ink)]">Revenue trend — last 6 months</h2>
          {trend && !hasEnoughTrendHistory && (
            <p className="text-sm text-[var(--muted)]">Not enough history for trend charts yet.</p>
          )}
          {trend && hasEnoughTrendHistory && (
            <RevenueTrendPanel
              categories={categories}
              revenuePaise={trendRevenuePaise}
              visitCounts={trendVisitCounts}
              revenueColumnLabel={revenueLabel}
              currentMonthIndices={trendInProgressIndices}
            />
          )}
        </section>

        {showTherapistBlock && report && (
          <section className="break-inside-avoid">
            <h2 className="mb-2 text-sm font-bold text-[var(--ink)]">
              Therapists — {monthName(period.month)} {period.year}
            </h2>
            <VisitsRevenueTrendChart
              categories={therapistChartCategories}
              fullCategories={therapistNames}
              visitCounts={report.rows.map((r) => r.visitCount)}
              revenuePaise={report.rows.map((r) => r.netPostTaxPaise)}
              visitsColor={SERIES_COLORS[1]}
              revenueColor={SERIES_COLORS[0]}
              formatRevenue={formatINR}
              compact={compact}
              currentMonthIndices={[]}
            />
            <div className="mt-4">
              <TherapistComparisonTable
                rows={comparisonRows}
                total={comparisonTotal}
                showPostTax={showPostTax}
                ownLabel={labels.own}
              />
            </div>
          </section>
        )}

        <section className="break-inside-avoid">
          <h2 className="mb-2 text-sm font-bold text-[var(--ink)]">Retention follow-ups</h2>
          <p className="mb-2 text-xs text-[var(--muted)]">
            Live queues as of today — not limited to {monthName(period.month)}.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Single-visit patients ({(singleVisitPatients ?? []).length})
              </h3>
              <ul className="space-y-1 text-xs text-[var(--ink)]">
                {(singleVisitPatients ?? []).slice(0, 6).map((p) => (
                  <li key={p.patientId} className="flex justify-between gap-2">
                    <span>{p.patientName}</span>
                    <span className="text-[var(--muted)]">{p.daysSince}d</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Stale packages ({stalePackages.length})
              </h3>
              <ul className="space-y-1 text-xs text-[var(--ink)]">
                {stalePackages.slice(0, 6).map((p) => (
                  <li key={p.packageGroupId} className="flex justify-between gap-2">
                    <span>{p.patientName}</span>
                    <span className="text-[var(--muted)]">{p.daysSinceLastVisit}d</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <footer className="border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
          Generated {formatDateDM(new Date().toISOString())} · {clinic.name}
        </footer>
      </div>
    </div>
  );
}
