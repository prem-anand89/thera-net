import { useMemo } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, reportService, dashboardService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { publicLogoUrl } from '@/lib/supabase';
import { formatINR } from '@/domain/money';
import { fiscalYearOf, monthDateRange, monthName, formatDateDM } from '@/domain/fiscalYear';
import { clinicBillingConfig, clinicShareLabels, REFERRING_SOURCE_LABELS } from '@/domain/types';
import { btnPrimary, btnSecondary, StatTile } from '@/components/ui';
import { MonthlyReportTable } from '@/components/MonthlyReportTable';
import { BarChart } from '@/components/BarChart';
import { PieChart } from '@/components/PieChart';
import { SERIES_COLORS } from '@/components/chartColors';

/** One row's worth of signed delta text under a StatTile — "+12% vs last
 *  month" / "−3 vs last month" — omitted (not shown as 0%/flat) when there's
 *  no prior-month baseline to compare against yet. */
function DeltaCaption({ value, suffix }: { value: number | null; suffix: string }) {
  if (value == null) return null;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return (
    <div className="mt-0.5 text-[10px] font-normal text-[var(--muted)]">
      {sign}
      {Math.abs(value)}
      {suffix} vs last month
    </div>
  );
}

/**
 * Print-only monthly review deck — clinic totals, per-therapist breakdown,
 * referral/condition mix, and retention follow-ups, all for one month, laid
 * out for a team meeting rather than daily use (that's Ledger/Workspace).
 * Same print shell as MonthlyLedgerPrintPage (letterhead, `.no-print`
 * button bar, A4 sizing) since both are "hand this to someone" documents,
 * but a separate page/route rather than a mode on that one — the two share
 * only the month/year picker, nothing else about their content overlaps.
 */
export function MonthlyPerformanceReportPage() {
  const clinic = useClinic();
  const { year, month } = useSearch({ strict: false }) as { year: number; month: number };
  const period = { year, month };
  const prevPeriod = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const labels = clinicShareLabels(clinic);
  const { hospitalSplit } = clinicBillingConfig(clinic);
  const fy = fiscalYearOf(new Date(period.year, period.month - 1, 1), clinic.fyStartMonth);
  const { from } = monthDateRange(period);

  const report = useLiveQuery(
    () => reportService.monthly(clinic.id, period),
    [clinic.id, period.year, period.month]
  );
  const prevReport = useLiveQuery(
    () => reportService.monthly(clinic.id, prevPeriod),
    [clinic.id, prevPeriod.year, prevPeriod.month]
  );
  const monthVisits = useLiveQuery(() => {
    const { from: f, to } = monthDateRange(period);
    return repos.visits.list({ clinicId: clinic.id, from: f, to });
  }, [clinic.id, period.year, period.month]);
  const allVisits = useLiveQuery(() => repos.visits.list({ clinicId: clinic.id }), [clinic.id]);
  const patients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  // Both real-time, "as of today" signals (not scoped to the selected
  // month) — the point of this section is what the team should follow up
  // on at the review meeting, not a historical record of a past month.
  const singleVisitPatients = useLiveQuery(
    () => dashboardService.singleVisitPatients(clinic.id),
    [clinic.id]
  );
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);

  const patientById = useMemo(() => new Map((patients ?? []).map((p) => [p.id, p])), [patients]);

  // Earliest visit date per patient across their FULL history (not just this
  // month) — the only way to tell "new this month" (first-ever visit falls
  // inside the window) apart from "returning" (has an earlier visit too).
  const firstVisitByPatient = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of allVisits ?? []) {
      if (v.deleted) continue;
      const cur = map.get(v.patientId);
      if (!cur || v.visitDate < cur) map.set(v.patientId, v.visitDate);
    }
    return map;
  }, [allVisits]);

  const activeMonthVisits = useMemo(
    () => (monthVisits ?? []).filter((v) => !v.deleted),
    [monthVisits]
  );

  const { newCount, returningCount } = useMemo(() => {
    const uniqueIds = new Set(activeMonthVisits.map((v) => v.patientId));
    let n = 0;
    let r = 0;
    for (const id of uniqueIds) {
      const first = firstVisitByPatient.get(id);
      if (first && first >= from) n++;
      else r++;
    }
    return { newCount: n, returningCount: r };
  }, [activeMonthVisits, firstVisitByPatient, from]);

  const referralData = useMemo(() => {
    const uniqueIds = new Set(activeMonthVisits.map((v) => v.patientId));
    const counts = new Map<string, number>();
    for (const id of uniqueIds) {
      const p = patientById.get(id);
      const label = p?.referringSource ? REFERRING_SOURCE_LABELS[p.referringSource] : 'Unspecified';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [activeMonthVisits, patientById]);

  const conditionData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of activeMonthVisits) {
      const c = v.condition?.trim() || 'Unspecified';
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [activeMonthVisits]);

  const stalePackages = useMemo(() => (openPackages ?? []).filter((p) => p.stale), [openPackages]);

  const revenueLabel = hospitalSplit ? `Post-Tax ${labels.own}` : 'Revenue';
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

  const therapistNames = (report?.rows ?? []).map((r) => r.therapistName);

  const logoUrl = useMemo(() => publicLogoUrl(clinic.logoPath), [clinic.logoPath]);

  return (
    <div className="min-h-screen bg-[var(--paper)] print:bg-[var(--surface)]">
      <style>{`@page { size: A4 portrait; margin: 10mm; }`}</style>

      <div className="no-print mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
        <Link to="/insights" search={{ tab: 'monthly' }} className={btnSecondary}>
          ← Back
        </Link>
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
              <p className="text-xs text-[var(--muted)]">Monthly Performance Report</p>
            </div>
          </div>
          <p className="shrink-0 text-sm text-[var(--muted)]">
            {monthName(period.month)} {period.year} · FY {fy.label}
          </p>
        </header>

        {/* Clinic totals */}
        <section>
          <h2 className="mb-2 text-sm font-bold text-[var(--ink)]">Clinic totals</h2>
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
            <StatTile label="New patients" value={newCount} />
            <StatTile label="Returning patients" value={returningCount} />
          </div>
        </section>

        {/* Per-therapist breakdown */}
        {report && therapistNames.length > 0 && (
          <section className="break-inside-avoid">
            <h2 className="mb-2 text-sm font-bold text-[var(--ink)]">Per-therapist breakdown</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  {revenueLabel}
                </h3>
                <BarChart
                  categories={therapistNames}
                  series={[
                    {
                      label: revenueLabel,
                      color: SERIES_COLORS[0],
                      values: report.rows.map((r) => r.netPostTaxPaise),
                    },
                  ]}
                  formatValue={formatINR}
                />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  Visits
                </h3>
                <BarChart
                  categories={therapistNames}
                  series={[
                    {
                      label: 'Visits',
                      color: SERIES_COLORS[1],
                      values: report.rows.map((r) => r.visitCount),
                    },
                  ]}
                />
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <MonthlyReportTable
                report={report}
                hospitalSplit={hospitalSplit}
                own={labels.own}
                partner={labels.partner}
              />
            </div>
          </section>
        )}

        {/* Referral sources & conditions */}
        <section className="break-inside-avoid">
          <h2 className="mb-2 text-sm font-bold text-[var(--ink)]">
            Referral sources &amp; conditions
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Referral sources
              </h3>
              {referralData.length > 0 ? (
                <PieChart data={referralData} showPercent />
              ) : (
                <p className="text-sm text-[var(--muted)]">No visits this month.</p>
              )}
            </div>
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Conditions treated
              </h3>
              {conditionData.length > 0 ? (
                <PieChart data={conditionData} showPercent />
              ) : (
                <p className="text-sm text-[var(--muted)]">No visits this month.</p>
              )}
            </div>
          </div>
        </section>

        {/* Retention signals — live, not month-scoped (see hook comment above) */}
        <section className="break-inside-avoid">
          <h2 className="mb-1 text-sm font-bold text-[var(--ink)]">Retention follow-ups</h2>
          <p className="mb-2 text-xs text-[var(--muted)]">
            As of today, not scoped to {monthName(period.month)} — talking points for the review,
            not a record of the month.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Single-visit patients ({(singleVisitPatients ?? []).length})
              </h3>
              <ul className="space-y-1 text-xs text-[var(--ink)]">
                {(singleVisitPatients ?? []).slice(0, 8).map((p) => (
                  <li key={p.patientId} className="flex justify-between gap-2">
                    <span>{p.patientName}</span>
                    <span className="text-[var(--muted)]">{p.daysSince}d since</span>
                  </li>
                ))}
                {(singleVisitPatients ?? []).length === 0 && (
                  <li className="text-[var(--muted)]">None right now.</li>
                )}
                {(singleVisitPatients ?? []).length > 8 && (
                  <li className="text-[var(--muted)]">
                    +{(singleVisitPatients ?? []).length - 8} more
                  </li>
                )}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Stale packages ({stalePackages.length})
              </h3>
              <ul className="space-y-1 text-xs text-[var(--ink)]">
                {stalePackages.slice(0, 8).map((p) => (
                  <li key={p.packageGroupId} className="flex justify-between gap-2">
                    <span>
                      {p.patientName} · {p.sessionsLogged}/{p.packageTotal}
                    </span>
                    <span className="text-[var(--muted)]">{p.daysSinceLastVisit}d since</span>
                  </li>
                ))}
                {stalePackages.length === 0 && (
                  <li className="text-[var(--muted)]">None right now.</li>
                )}
                {stalePackages.length > 8 && (
                  <li className="text-[var(--muted)]">+{stalePackages.length - 8} more</li>
                )}
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
