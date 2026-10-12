import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService, reportService, settlementService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import type { Paise } from '@/domain/money';
import { fiscalYearOf, monthsOfFiscalYear, monthName, formatDateDM, type FyMonth } from '@/domain/fiscalYear';
import { clinicBillingConfig, clinicShareLabels, type SettlementPayment } from '@/domain/types';
import {
  btnPrimary,
  btnSecondary,
  inputCls,
  chipSelect,
  chipSelectChevron as chevron,
  Field,
  RupeeInput,
  SectionCard,
  ErrorNote,
} from '@/components/ui';
import { MonthlyReportTable } from '@/components/MonthlyReportTable';
import { toFriendlyMessage } from '@/lib/errors';
import { SERIES_COLORS } from '@/components/chartColors';
import { VisitsRevenueTrendChart } from '@/components/VisitsRevenueTrendChart';
import { MonthlyRevenueChart } from '@/components/MonthlyRevenueChart';
import { MonthlyVisitsChart } from '@/components/MonthlyVisitsChart';
import { useCompactChart } from '@/components/useCompactChart';

export function MonthlyStatementPage() {
  const clinic = useClinic();
  const labels = clinicShareLabels(clinic);
  const { partnerSplit, therapistSplit } = clinicBillingConfig(clinic);
  const currentFy = fiscalYearOf(new Date(), clinic.fyStartMonth);
  const [fyStartYear, setFyStartYear] = useState(currentFy.startYear);
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${now.getMonth() + 1}`);

  const months = useMemo(
    () => monthsOfFiscalYear(fyStartYear, clinic.fyStartMonth),
    [fyStartYear, clinic.fyStartMonth]
  );

  const selected = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return { year: y, month: m };
  }, [month]);

  const report = useLiveQuery(
    () => reportService.monthly(clinic.id, selected),
    [clinic.id, selected.year, selected.month]
  );

  const trendMonths = useMemo(() => {
    const res = [];
    let y = selected.year;
    let m = selected.month;
    for (let i = 0; i < 6; i++) {
      res.unshift({ year: y, month: m });
      m--;
      if (m < 1) {
        m = 12;
        y--;
      }
    }
    return res;
  }, [selected.year, selected.month]);

  const trendData = useLiveQuery(
    () => dashboardService.revenueTrend(clinic.id, trendMonths),
    [clinic.id, trendMonths]
  );

  const trendCategories = useMemo(
    () =>
      (trendData ?? []).map(
        (r) => `${monthName(r.month.month).slice(0, 3)} '${String(r.month.year).slice(2)}`
      ),
    [trendData]
  );
  
  const trendVisits = useMemo(() => (trendData ?? []).map((r) => r.total.visitCount), [trendData]);
  const trendRevenue = useMemo(
    () => (trendData ?? []).map((r) => r.total.postTaxPaise),
    [trendData]
  );

  const [showTrend, setShowTrend] = useState(false);
  const [chartViewMode, setChartViewMode] = useState<'split' | 'combined'>('split');
  const [chartSelectedIndex, setChartSelectedIndex] = useState<number | null>(null);
  const compactChart = useCompactChart();

  useEffect(() => {
    if (trendCategories.length > 0) {
      setChartSelectedIndex(trendCategories.length - 1);
    }
  }, [trendCategories.length, selected.year, selected.month]);

  const sixMonthTotalRevenue = useMemo(
    () => trendRevenue.reduce((sum, v) => sum + v, 0),
    [trendRevenue]
  );
  const sixMonthTotalVisits = useMemo(
    () => trendVisits.reduce((sum, v) => sum + v, 0),
    [trendVisits]
  );
  const sixMonthAvgRevenue = useMemo(
    () => (trendRevenue.length > 0 ? Math.round(sixMonthTotalRevenue / trendRevenue.length) : 0),
    [sixMonthTotalRevenue, trendRevenue.length]
  );
  const sixMonthAvgVisits = useMemo(
    () => (trendVisits.length > 0 ? Math.round(sixMonthTotalVisits / trendVisits.length) : 0),
    [sixMonthTotalVisits, trendVisits.length]
  );

  const selectedMonthRevenue = trendRevenue[trendRevenue.length - 1] ?? 0;
  const revenueVsAvgPct =
    sixMonthAvgRevenue > 0
      ? Math.round(((selectedMonthRevenue - sixMonthAvgRevenue) / sixMonthAvgRevenue) * 100)
      : null;

  const currentMonthIndices = useMemo(() => {
    const isCurrent = selected.year === now.getFullYear() && selected.month === now.getMonth() + 1;
    return isCurrent && trendCategories.length > 0 ? [trendCategories.length - 1] : [];
  }, [selected.year, selected.month, trendCategories.length, now]);

  const trendPeriodRange = useMemo(() => {
    if (trendCategories.length === 0) return '';
    return `${trendCategories[0]} – ${trendCategories[trendCategories.length - 1]}`;
  }, [trendCategories]);

  // A 0% TDS rate leaves the split itself in place, but with nothing
  // actually withheld "Post-Tax" no longer describes the figure.
  const showPostTax = useMemo(
    () => partnerSplit && (report?.total.tdsPaise ?? 0) > 0,
    [partnerSplit, report]
  );

  function downloadCsv() {
    if (!report) return;
    const blob = new Blob(
      [reportService.toCsv(report, { labels, partnerSplit, showPostTax, therapistSplit })],
      {
        type: 'text/csv',
      }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clinic.invoicePrefix}-report-${selected.year}-${String(selected.month).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-base font-semibold text-[var(--ink)]">
          Monthly statement
        </h2>
        {/* `w-full` on mobile (its own line below the title) vs `sm:w-auto` to sit
            beside the title once there's room. Wraps instead of scrolling
            sideways so the Export buttons are never cut off the edge. */}
        <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <select
            className={chipSelect}
            style={chevron}
            aria-label="Fiscal year"
            value={fyStartYear}
            onChange={(e) => setFyStartYear(Number(e.target.value))}
          >
            {[currentFy.startYear - 2, currentFy.startYear - 1, currentFy.startYear].map((y) => (
              <option key={y} value={y}>
                FY{' '}
                {fiscalYearOf(new Date(y, clinic.fyStartMonth - 1, 1), clinic.fyStartMonth).label}
              </option>
            ))}
          </select>
          <select
            className={chipSelect}
            style={chevron}
            aria-label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            {months.map((m) => (
              <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                {monthName(m.month)} {m.year}
              </option>
            ))}
          </select>
          <span className="hidden h-5 w-px shrink-0 bg-[var(--border)] sm:block" aria-hidden />
          <button
            type="button"
            className={`${btnSecondary} shrink-0 whitespace-nowrap`}
            onClick={downloadCsv}
          >
            Export CSV
          </button>
          <Link
            to="/insights/print"
            search={{ year: selected.year, month: selected.month }}
            className={`${btnSecondary} shrink-0 whitespace-nowrap`}
          >
            Export as PDF
          </Link>
        </div>
      </div>

      {/* Redesigned 6-Month Trend Card */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xs overflow-hidden">
        <button
          type="button"
          onClick={() => setShowTrend((s) => !s)}
          className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--paper)]/60 cursor-pointer"
          aria-expanded={showTrend}
        >
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--teal-light)] text-sm shrink-0"
              aria-hidden="true"
            >
              📈
            </span>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="font-display text-sm font-semibold text-[var(--ink)]">
                6-Month Trend
              </span>
              {trendPeriodRange && (
                <span className="rounded-full border border-[var(--border)] bg-[var(--paper)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
                  {trendPeriodRange}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            {trendCategories.length > 0 && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-[var(--muted)]">
                <span>6M Total:</span>
                <strong className="font-num font-semibold text-[var(--ink)]">
                  {formatINR(sixMonthTotalRevenue)}
                </strong>
                <span>·</span>
                <strong className="font-num font-semibold text-[var(--ink)]">
                  {sixMonthTotalVisits} visits
                </strong>
              </div>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--paper)] px-2.5 py-1 text-xs font-semibold text-[var(--ink)] shadow-2xs">
              <span>{showTrend ? 'Hide trend' : 'Show trend'}</span>
              <span aria-hidden="true">{showTrend ? '▴' : '▾'}</span>
            </span>
          </div>
        </button>

        {showTrend && trendCategories.length > 0 && (
          <div className="border-t border-[var(--border)]">
            {/* 6-Month Summary KPIs Ribbon */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 p-3 sm:p-4 border-b border-[var(--border)] bg-[var(--paper)]/40">
              {/* Tile 1: 6M Revenue */}
              <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 sm:p-3 shadow-2xs">
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] truncate">
                  6M Total Revenue
                </div>
                <div className="mt-1 font-num text-base sm:text-lg font-semibold text-[var(--ink)] truncate">
                  {formatINR(sixMonthTotalRevenue)}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--muted)] truncate">
                  {showPostTax ? `Post-Tax ${labels.own}` : labels.own}
                </div>
              </div>

              {/* Tile 2: 6M Visits */}
              <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 sm:p-3 shadow-2xs">
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] truncate">
                  6M Total Visits
                </div>
                <div className="mt-1 font-num text-base sm:text-lg font-semibold text-[var(--ink)]">
                  {sixMonthTotalVisits}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--muted)] truncate">
                  avg. {sixMonthAvgVisits} / month
                </div>
              </div>

              {/* Tile 3: Selected Month Share */}
              <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 sm:p-3 shadow-2xs">
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] truncate">
                  {monthName(selected.month).slice(0, 3)} '{String(selected.year).slice(2)} Revenue
                </div>
                <div className="mt-1 font-num text-base sm:text-lg font-semibold text-[var(--ink)] truncate">
                  {formatINR(selectedMonthRevenue)}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--muted)] truncate">
                  {sixMonthTotalRevenue > 0
                    ? `${Math.round((selectedMonthRevenue / sixMonthTotalRevenue) * 100)}% of 6M total`
                    : '—'}
                </div>
              </div>

              {/* Tile 4: Vs 6M Average */}
              <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 sm:p-3 shadow-2xs">
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] truncate">
                  vs 6M Monthly Avg
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span
                    className={`font-num text-base sm:text-lg font-semibold ${
                      revenueVsAvgPct == null || revenueVsAvgPct === 0
                        ? 'text-[var(--ink)]'
                        : revenueVsAvgPct > 0
                          ? 'text-[var(--teal)]'
                          : 'text-[var(--rust)]'
                    }`}
                  >
                    {revenueVsAvgPct != null ? `${revenueVsAvgPct >= 0 ? '+' : ''}${revenueVsAvgPct}%` : '—'}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--muted)] truncate">
                  avg: {formatINR(sixMonthAvgRevenue)}
                </div>
              </div>
            </div>

            {/* Interactive Charts Area */}
            <div className="p-3 sm:p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[var(--muted)]">
                  Click a month bar to inspect its MoM performance
                </span>
                <div
                  className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--paper)] p-0.5"
                  role="group"
                  aria-label="Chart view mode"
                >
                  <button
                    type="button"
                    aria-pressed={chartViewMode === 'split'}
                    onClick={() => setChartViewMode('split')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${
                      chartViewMode === 'split'
                        ? 'bg-[var(--surface)] text-[var(--ink)] font-semibold shadow-xs'
                        : 'text-[var(--muted)] hover:text-[var(--ink)]'
                    }`}
                  >
                    Side-by-side
                  </button>
                  <button
                    type="button"
                    aria-pressed={chartViewMode === 'combined'}
                    onClick={() => setChartViewMode('combined')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${
                      chartViewMode === 'combined'
                        ? 'bg-[var(--surface)] text-[var(--ink)] font-semibold shadow-xs'
                        : 'text-[var(--muted)] hover:text-[var(--ink)]'
                    }`}
                  >
                    Combined
                  </button>
                </div>
              </div>

              {chartViewMode === 'split' ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <MonthlyRevenueChart
                    categories={trendCategories}
                    revenuePaise={trendRevenue}
                    formatRevenue={formatINR}
                    currentMonthIndices={currentMonthIndices}
                    selectedIndex={chartSelectedIndex}
                    onSelectIndex={setChartSelectedIndex}
                  />
                  <MonthlyVisitsChart
                    categories={trendCategories}
                    visitCounts={trendVisits}
                    currentMonthIndices={currentMonthIndices}
                    selectedIndex={chartSelectedIndex}
                    onSelectIndex={setChartSelectedIndex}
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper)]/30 p-3 sm:p-4">
                  <VisitsRevenueTrendChart
                    categories={trendCategories}
                    visitCounts={trendVisits}
                    revenuePaise={trendRevenue}
                    visitsColor={SERIES_COLORS[1]}
                    revenueColor={SERIES_COLORS[0]}
                    formatRevenue={formatINR}
                    compact={compactChart}
                    currentMonthIndices={currentMonthIndices}
                    selectedCategoryIndex={chartSelectedIndex}
                    onCategoryHover={setChartSelectedIndex}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="mb-2 text-xs text-[var(--muted)] sm:hidden">
        Swipe sideways to see more columns.
      </p>
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
        <div className="overflow-x-auto overscroll-x-contain">
          <MonthlyReportTable
          report={report}
          partnerSplit={partnerSplit}
          showPostTax={showPostTax}
          showShared={therapistSplit}
          own={labels.own}
          partner={labels.partner}
          auditLinkMonth={therapistSplit ? selected : undefined}
        />
        </div>
      </div>
      {therapistSplit && (
        <p className="text-xs text-[var(--muted)]">
          Wondering where a Shared or Net figure came from?{' '}
          <Link
            to="/insights"
            search={{ tab: 'audit', year: selected.year, month: selected.month }}
            className="font-medium text-[var(--teal)] hover:underline"
          >
            See the attribution audit
          </Link>{' '}
          for this month's per-visit detail.
        </p>
      )}

      <p className="text-xs text-[var(--muted)]">
        Patients = unique patients in the month, not visit count.
        {partnerSplit && (
          <>
            {' '}
            TDS basis for new visits:{' '}
            {clinic.tdsBasis === 'gross_bill'
              ? `${clinic.taxPct}%-of-gross-bill (matches the ${labels.partner} sheet)`
              : `on ${labels.own} share`}
            ; each visit keeps the basis and rates that were active when it was billed.
          </>
        )}
      </p>

      {partnerSplit && (
        <SettlementCard
          clinicId={clinic.id}
          month={selected}
          expectedPaise={report?.total.postTaxPaise ?? null}
          labels={labels}
          showPostTax={showPostTax}
        />
      )}
    </div>
  );
}

/**
 * A partner hospital rarely pays a month's settlement as one lump sum — an
 * advance plus a final tranche is typical, sometimes with an unrelated
 * deduction explained only in a note on that specific payment. Recording
 * one editable amount/date/notes per month (the old model) forced every
 * later tranche to overwrite the one before it, so a clinic reconciling a
 * month with two real payments had nowhere to keep the first one's own
 * date/note once the second was entered. Each tranche is now its own row;
 * "received" for the month is their sum (settlementService.totalReceived).
 */
function SettlementCard({
  clinicId,
  month,
  expectedPaise,
  labels,
  showPostTax,
}: {
  clinicId: string;
  month: FyMonth;
  expectedPaise: Paise | null;
  labels: { own: string; partner: string };
  /** At 0% TDS the expected figure is still the clinic's computed share,
   *  just nothing was actually withheld from it — "Post Tax" would overstate
   *  that. */
  showPostTax: boolean;
}) {
  const payments = useLiveQuery(
    () => settlementService.listPayments(clinicId, month.year, month.month),
    [clinicId, month.year, month.month]
  );
  const [editing, setEditing] = useState<SettlementPayment | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalReceivedPaise = (payments ?? []).reduce((sum, p) => sum + p.amountReceivedPaise, 0);
  const variancePaise = payments && expectedPaise != null ? totalReceivedPaise - expectedPaise : null;

  async function remove(id: string) {
    setError(null);
    try {
      await settlementService.deletePayment(id);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  return (
    <SectionCard title={`${labels.partner} settlement — ${monthName(month.month)} ${month.year}`}>
      <p className="text-sm text-[var(--muted)]">
        Expected (computed {showPostTax ? `Post Tax ${labels.own}` : `${labels.own} Share`}):{' '}
        <span className="font-medium text-[var(--ink)]">
          {expectedPaise != null ? formatINR(expectedPaise) : '—'}
        </span>
      </p>

      {payments && payments.length > 0 && (
        <div className="mt-3 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-[var(--ink)]">
                  {formatINR(p.amountReceivedPaise)}
                </span>
                {p.receivedDate && (
                  <span className="ml-2 text-[var(--muted)]">{formatDateDM(p.receivedDate)}</span>
                )}
                {p.notes && <span className="ml-2 truncate text-[var(--muted)]">— {p.notes}</span>}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--teal)] hover:underline"
                  onClick={() => setEditing(p)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--rust)] hover:underline"
                  onClick={() => void remove(p.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-sm font-medium text-[var(--ink)]">
        Total received: {formatINR(totalReceivedPaise as Paise)}
      </p>
      {variancePaise != null && (
        <p
          className={`text-sm font-medium ${variancePaise === 0 ? 'text-[var(--moss)]' : 'text-[var(--rust)]'}`}
        >
          Variance: {variancePaise >= 0 ? '+' : ''}
          {formatINR(variancePaise as Paise)}
        </p>
      )}

      <div className="mt-3">
        {adding || editing ? (
          <SettlementPaymentForm
            clinicId={clinicId}
            month={month}
            existing={editing}
            onDone={() => {
              setAdding(false);
              setEditing(null);
            }}
          />
        ) : (
          <button type="button" className={btnSecondary} onClick={() => setAdding(true)}>
            + Record a payment
          </button>
        )}
      </div>
      <ErrorNote message={error} />
    </SectionCard>
  );
}

/** Add-or-edit form for one settlement tranche — a separate small component
 *  so its own draft state (amount/date/notes being typed) doesn't leak into
 *  SettlementCard's list-rendering state. */
function SettlementPaymentForm({
  clinicId,
  month,
  existing,
  onDone,
}: {
  clinicId: string;
  month: FyMonth;
  existing: SettlementPayment | null;
  onDone: () => void;
}) {
  const [amountPaise, setAmountPaise] = useState<Paise | null>(existing?.amountReceivedPaise ?? null);
  const [receivedDate, setReceivedDate] = useState(existing?.receivedDate ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const input = {
        amountReceivedPaise: amountPaise ?? 0,
        receivedDate: receivedDate || null,
        notes: notes || null,
      };
      if (existing) {
        await settlementService.editPayment(existing, input);
      } else {
        await settlementService.addPayment(clinicId, month.year, month.month, input);
      }
      onDone();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--paper)] p-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Amount received">
          <RupeeInput valuePaise={amountPaise} onChange={setAmountPaise} />
        </Field>
        <Field label="Received date">
          <input
            type="date"
            className={inputCls}
            value={receivedDate}
            onChange={(e) => setReceivedDate(e.target.value)}
          />
        </Field>
        <Field label="Notes">
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={busy} className={btnPrimary} onClick={() => void submit()}>
          {existing ? 'Save changes' : 'Add payment'}
        </button>
        <button type="button" className={btnSecondary} onClick={onDone}>
          Cancel
        </button>
      </div>
      <ErrorNote message={error} />
    </div>
  );
}
