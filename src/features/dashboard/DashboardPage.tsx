import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { monthName, formatDateDMY } from '@/domain/fiscalYear';
import { clinicBillingConfig, clinicShareLabels } from '@/domain/types';
import { SectionCard, StatTile, th, thNum, td, tdNum } from '@/components/ui';
import { BarChart } from '@/components/BarChart';

// Reference categorical palette — all 8 validated slots in fixed order,
// assigned by index and never cycled (a 9th series would repeat hues and
// break CVD separation; fold into "Other" before that ever happens).
const SERIES_COLORS = [
  '#2a78d6', // blue
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
  '#e87ba4', // magenta
  '#eb6834', // orange
];

export function DashboardPage() {
  const clinic = useClinic();
  const labels = clinicShareLabels(clinic);
  const { hospitalSplit } = clinicBillingConfig(clinic);
  const revenueLabel = hospitalSplit ? `Post-Tax ${labels.own}` : 'Revenue';

  const trend = useLiveQuery(() => dashboardService.revenueTrend(clinic.id), [clinic.id]);
  const outstanding = useLiveQuery(() => dashboardService.outstandingInvoices(clinic.id), [clinic.id]);
  const singleVisitPatients = useLiveQuery(
    () => dashboardService.singleVisitPatients(clinic.id),
    [clinic.id]
  );
  const recurringPatients = useLiveQuery(
    () => dashboardService.recurringPatients(clinic.id),
    [clinic.id]
  );

  const categories = useMemo(
    () => (trend ?? []).map((r) => `${monthName(r.month.month).slice(0, 3)} '${String(r.month.year).slice(2)}`),
    [trend]
  );

  const therapistNames = useMemo(
    () => [...new Set((trend ?? []).flatMap((r) => r.rows.map((row) => row.therapistName)))].sort(),
    [trend]
  );

  return (
    <div className="space-y-6">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Dashboard</h1>

      <SectionCard title="Single-visit patients">
        <p className="mb-3 text-xs text-[var(--muted)]">
          Exactly one visit on record, more than 14 days ago — worth a call to find out why, or a
          reminder to book again.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--border)] text-sm">
            <thead>
              <tr>
                <th className={th}>Patient</th>
                <th className={th}>Service</th>
                <th className={th}>Visited on</th>
                <th className={thNum}>Days since</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {(singleVisitPatients ?? []).map((p) => (
                <tr key={p.patientId} className="hover:bg-[var(--paper)]">
                  <td className={td}>
                    <span className="font-display">{p.patientName}</span>{' '}
                    <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
                  </td>
                  <td className={td}>{p.serviceName}</td>
                  <td className={td}>{formatDateDMY(p.visitDate)}</td>
                  <td className={tdNum}>{p.daysSince}</td>
                  <td className={td}>
                    <Link
                      to="/archive"
                      search={{ patientId: p.patientId }}
                      className="font-medium text-[var(--teal)] hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {singleVisitPatients?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-[var(--muted)]">
                    No lapsed single-visit patients right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Regulars — last 30 days">
        <p className="mb-3 text-xs text-[var(--muted)]">
          Three or more visits in the last month — your most engaged patients right now.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--border)] text-sm">
            <thead>
              <tr>
                <th className={th}>Patient</th>
                <th className={thNum}>Visits</th>
                <th className={th}>Last visit</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {(recurringPatients ?? []).map((p) => (
                <tr key={p.patientId} className="hover:bg-[var(--paper)]">
                  <td className={td}>
                    <span className="font-display">{p.patientName}</span>{' '}
                    <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
                  </td>
                  <td className={tdNum}>{p.visitCount}</td>
                  <td className={td}>{formatDateDMY(p.lastVisitOn)}</td>
                  <td className={td}>
                    <Link
                      to="/archive"
                      search={{ patientId: p.patientId }}
                      className="font-medium text-[var(--teal)] hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {recurringPatients?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-[var(--muted)]">
                    No one has visited 3+ times in the last 30 days yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Outstanding payments">
        <div className="mb-4 flex gap-4">
          <StatTile label="Total outstanding" value={formatINR(outstanding?.totalPaise ?? 0)} />
          <StatTile label="Invoices" value={outstanding?.count ?? 0} />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--border)] text-sm">
            <thead>
              <tr>
                <th className={th}>Invoice №</th>
                <th className={th}>Patient</th>
                <th className={thNum}>Amount</th>
                <th className={th}>Issued</th>
                <th className={thNum}>Days outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {(outstanding?.rows ?? []).map((r) => (
                <tr key={r.invoiceId} className="hover:bg-[var(--paper)]">
                  <td className={td}>
                    <Link
                      to="/invoices/$invoiceId/print"
                      params={{ invoiceId: r.invoiceId }}
                      className="text-[var(--teal)] hover:underline"
                    >
                      {r.invoiceNo}
                    </Link>
                  </td>
                  <td className={td}>
                    <span className="font-display">{r.patientName}</span> <span className="text-xs text-[var(--muted)]">{r.mrno}</span>
                  </td>
                  <td className={tdNum}>{formatINR(r.totalPaise)}</td>
                  <td className={td}>{formatDateDMY(r.issuedAt)}</td>
                  <td className={tdNum}>{r.daysOutstanding}</td>
                </tr>
              ))}
              {outstanding?.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-[var(--muted)]">
                    Nothing outstanding.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title={`Revenue trend — last 6 months (${revenueLabel})`}>
        {trend && (
          <BarChart
            categories={categories}
            series={[
              {
                label: revenueLabel,
                color: SERIES_COLORS[0],
                values: trend.map((r) => r.total.postTaxPaise),
              },
            ]}
            formatValue={formatINR}
          />
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--border)] text-sm">
            <thead>
              <tr>
                <th className={th}>Month</th>
                <th className={thNum}>Bill</th>
                {hospitalSplit && <th className={thNum}>{labels.own} Share</th>}
                {hospitalSplit && <th className={thNum}>TDS</th>}
                {hospitalSplit && <th className={thNum}>Post Tax</th>}
                {hospitalSplit && <th className={thNum}>{labels.partner}</th>}
                <th className={thNum}>Visits</th>
                <th className={thNum}>Patients</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {(trend ?? []).map((r, i) => (
                <tr key={i} className="hover:bg-[var(--paper)]">
                  <td className={td}>{categories[i]}</td>
                  <td className={tdNum}>{formatINR(r.total.billPaise)}</td>
                  {hospitalSplit && <td className={tdNum}>{formatINR(r.total.bmSharePaise)}</td>}
                  {hospitalSplit && <td className={tdNum}>{formatINR(r.total.tdsPaise)}</td>}
                  {hospitalSplit && <td className={tdNum}>{formatINR(r.total.postTaxPaise)}</td>}
                  {hospitalSplit && <td className={tdNum}>{formatINR(r.total.hvPaise)}</td>}
                  <td className={tdNum}>{r.total.visitCount}</td>
                  <td className={tdNum}>{r.total.uniquePatients}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title={`Therapist comparison — ${revenueLabel}`}>
        {trend && therapistNames.length > 0 && (
          <BarChart
            categories={categories}
            series={therapistNames.slice(0, SERIES_COLORS.length).map((name, i) => ({
              label: name,
              color: SERIES_COLORS[i],
              values: trend.map((r) => r.rows.find((row) => row.therapistName === name)?.postTaxPaise ?? 0),
            }))}
            formatValue={formatINR}
          />
        )}
        {trend && therapistNames.length === 0 && (
          <p className="text-sm text-[var(--muted)]">No visits in the last 6 months.</p>
        )}
      </SectionCard>
    </div>
  );
}
