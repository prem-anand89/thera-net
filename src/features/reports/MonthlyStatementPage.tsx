import { useMemo, useState } from 'react';
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
  const compactChart = useCompactChart();

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
        {/* `w-full` on mobile (wraps onto its own line below the title,
            scrolling sideways rather than forcing the whole page wider —
            this cluster of 4 controls has no business fighting the title
            for one cramped row on a phone) vs `sm:w-auto` to sit beside
            the title again once there's room. Same scroll/trailing-padding
            treatment as the Schedule → Feedback filter row. */}
        <div className="ml-auto flex w-full items-center gap-2 overflow-x-auto pb-1 pr-2 sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0 sm:pr-0">
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
          <span className="h-5 w-px shrink-0 bg-[var(--border)]" aria-hidden />
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

      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowTrend((s) => !s)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)] focus:outline-none"
        >
          <span>6-Month Trend</span>
          <span className="text-xs text-[var(--muted)]">{showTrend ? '▲ Hide' : '▼ Show'}</span>
        </button>
        {showTrend && trendCategories.length > 0 && (
          <div className="border-t border-[var(--border)] p-4">
            <VisitsRevenueTrendChart
              categories={trendCategories}
              visitCounts={trendVisits}
              revenuePaise={trendRevenue}
              visitsColor={SERIES_COLORS[1]}
              revenueColor={SERIES_COLORS[0]}
              formatRevenue={formatINR}
              compact={compactChart}
            />
          </div>
        )}
      </div>

      <p className="mb-2 text-xs text-[var(--muted)] sm:hidden">
        Swipe sideways to see more columns.
      </p>
      <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
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
