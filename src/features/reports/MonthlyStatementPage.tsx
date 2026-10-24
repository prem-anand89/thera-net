import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService, reportService, settlementService } from '@/services';
import { partnerName } from '@/domain/paymentMethods';
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

export function MonthlyStatementPage() {
  const clinic = useClinic();
  const labels = clinicShareLabels(clinic);
  const { partnerSplit, therapistSplit } = clinicBillingConfig(clinic);
  const currentFy = fiscalYearOf(new Date(), clinic.fyStartMonth);
  const [fyStartYear, setFyStartYear] = useState(currentFy.startYear);
  const { currentYear, currentMonth } = useMemo(() => {
    const d = new Date();
    return { currentYear: d.getFullYear(), currentMonth: d.getMonth() + 1 };
  }, []);
  const [month, setMonth] = useState(`${currentYear}-${currentMonth}`);

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

  const collection = useLiveQuery(
    () => dashboardService.monthlyCollection(clinic.id, selected),
    [clinic.id, selected.year, selected.month]
  );

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
        <div>
          <h2 className="font-display text-base font-semibold text-[var(--ink)]">
            Monthly statement
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Audited financial breakdown for {monthName(selected.month)} {selected.year}
          </p>
        </div>
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

      {/* Executive Monthly KPI Summary Ribbon */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 sm:p-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--teal-light)] text-xs font-semibold text-[var(--teal-strong)]">
              📊
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              {monthName(selected.month)} {selected.year} Summary
            </span>
          </div>
          <Link
            to="/insights"
            className="text-xs font-medium text-[var(--teal)] hover:underline inline-flex items-center gap-1"
          >
            <span>View historical trends in Trends</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        <div className={`grid grid-cols-2 gap-2.5 sm:gap-3 ${partnerSplit ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
          {/* Card 1: Total Billed */}
          <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--paper)]/50 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] truncate">
              Total Billed
            </div>
            <div className="mt-1 font-num text-lg sm:text-xl font-semibold text-[var(--ink)] truncate">
              {report ? formatINR(report.total.billPaise) : '—'}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--muted)] truncate">
              {report?.total.billedSessionCount ?? 0} billed sessions
            </div>
          </div>

          {/* Card 2, no partner: what was actually received. (With a partner the clinic's share is the figure that matters.) */}
          {!partnerSplit && (
            <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--paper)]/50 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] truncate">
                Collected
              </div>
              <div className="mt-1 font-num text-lg sm:text-xl font-semibold text-[var(--teal-strong)] truncate">
                {collection ? formatINR(collection.collectedPaise) : '—'}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)] truncate">
                {collection
                  ? collection.billedPaise > collection.collectedPaise
                    ? `${formatINR(collection.billedPaise - collection.collectedPaise)} still due`
                    : 'Nothing due'
                  : '—'}
              </div>
            </div>
          )}

          {/* Card 2: Clinic Share (Net) */}
          {partnerSplit && (
          <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--paper)]/50 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] truncate">
              {showPostTax ? `Post-Tax ${labels.own}` : `${labels.own} Share`}
            </div>
            <div className="mt-1 font-num text-lg sm:text-xl font-semibold text-[var(--teal-strong)] truncate">
              {report ? formatINR(report.total.netPostTaxPaise) : '—'}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--muted)] truncate">
              {report && (report.total.tdsPaise ?? 0) > 0 ? (
                <span>TDS: {formatINR(report.total.tdsPaise)} withheld</span>
              ) : (
                <span>Net clinic earnings</span>
              )}
            </div>
          </div>
          )}

          {/* Card 3: Partner Share (if applicable) */}
          {partnerSplit && (
            <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--paper)]/50 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] truncate">
                {labels.partner} Share
              </div>
              <div className="mt-1 font-num text-lg sm:text-xl font-semibold text-[var(--ink)] truncate">
                {report ? formatINR(report.total.partnerSharePaise) : '—'}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)] truncate">
                {100 - clinic.clinicSplitPct}% contractual cut
              </div>
            </div>
          )}

          {/* Card 4: Visits & Patients */}
          <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--paper)]/50 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] truncate">
              Visits & Patients
            </div>
            <div className="mt-1 font-num text-lg sm:text-xl font-semibold text-[var(--ink)] truncate">
              {report ? `${report.total.visitCount} visits` : '—'}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--muted)] truncate">
              {report ? `${report.total.uniquePatients} unique patients` : '—'}
            </div>
          </div>
        </div>
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
          expectedPaise={
            clinic.partnerCollects ? (report?.total.postTaxPaise ?? null) : (report?.total.partnerSharePaise ?? null)
          }
          partnerCollects={Boolean(clinic.partnerCollects)}
          partnerCollectedPaise={collection?.partnerCollectedPaise ?? 0}
          partnerCollectedVisits={collection?.partnerCollectedVisitCount ?? 0}
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
  partnerCollects,
  partnerCollectedPaise,
  partnerCollectedVisits,
  labels,
  showPostTax,
}: {
  clinicId: string;
  month: FyMonth;
  expectedPaise: Paise | null;
  /** The partner collects patients' payments and owes the clinic its share; otherwise the clinic collects and owes the partner theirs. */
  partnerCollects: boolean;
  partnerCollectedPaise: Paise;
  partnerCollectedVisits: number;
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
  // Received from the partner: positive variance = they paid more than expected. Paid to the partner: what is still to pay.
  const variancePaise =
    payments && expectedPaise != null
      ? partnerCollects
        ? totalReceivedPaise - expectedPaise
        : expectedPaise - totalReceivedPaise
      : null;
  const partner = partnerName(useClinic());

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
        {partnerCollects
          ? `Expected from ${partner} (computed ${showPostTax ? `Post Tax ${labels.own}` : `${labels.own} Share`}):`
          : `${labels.partner} share to pay (computed):`}{' '}
        <span className="font-medium text-[var(--ink)]">
          {expectedPaise != null ? formatINR(expectedPaise) : '—'}
        </span>
      </p>
      {partnerCollectedPaise > 0 && (
        <p className="text-sm text-[var(--muted)]">
          Collected by {partner} this month:{' '}
          <span className="font-medium text-[var(--ink)]">{formatINR(partnerCollectedPaise)}</span> (
          {partnerCollectedVisits} visit{partnerCollectedVisits === 1 ? '' : 's'})
        </p>
      )}

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
        {partnerCollects ? 'Total received' : `Total paid to ${partner}`}: {formatINR(totalReceivedPaise as Paise)}
      </p>
      {variancePaise != null && (
        <p
          className={`text-sm font-medium ${variancePaise === 0 ? 'text-[var(--moss)]' : 'text-[var(--rust)]'}`}
        >
          {partnerCollects ? 'Variance' : 'Still to pay'}:{' '}
          {partnerCollects && variancePaise >= 0 ? '+' : ''}
          {formatINR(variancePaise as Paise)}
        </p>
      )}

      <div className="mt-3">
        {adding || editing ? (
          <SettlementPaymentForm
            clinicId={clinicId}
            month={month}
            existing={editing}
            paying={!partnerCollects}
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
  paying,
  onDone,
}: {
  clinicId: string;
  month: FyMonth;
  existing: SettlementPayment | null;
  /** The clinic pays the partner (it collected the patients' money); otherwise the partner pays the clinic. */
  paying: boolean;
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
        <Field label={paying ? 'Amount paid' : 'Amount received'}>
          <RupeeInput valuePaise={amountPaise} onChange={setAmountPaise} />
        </Field>
        <Field label={paying ? 'Paid on' : 'Received date'}>
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
