import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { reportService, settlementService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import type { Paise } from '@/domain/money';
import { fiscalYearOf, monthsOfFiscalYear, monthName, type FyMonth } from '@/domain/fiscalYear';
import { clinicBillingConfig, clinicShareLabels } from '@/domain/types';
import { btnPrimary, btnSecondary, inputCls, Field, RupeeInput, SectionCard, ErrorNote } from '@/components/ui';
import { MonthlyReportTable } from '@/components/MonthlyReportTable';
import { toFriendlyMessage } from '@/lib/errors';

export function ReportsPage() {
  const clinic = useClinic();
  const labels = clinicShareLabels(clinic);
  const { hospitalSplit, therapistSplit } = clinicBillingConfig(clinic);
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

  function downloadCsv() {
    if (!report) return;
    const blob = new Blob([reportService.toCsv(report, { labels, hospitalSplit, therapistSplit })], {
      type: 'text/csv',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clinic.invoicePrefix}-report-${selected.year}-${String(selected.month).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Monthly report</h1>
        <div className="ml-auto flex items-end gap-2">
          <select
            className={inputCls}
            value={fyStartYear}
            onChange={(e) => setFyStartYear(Number(e.target.value))}
          >
            {[currentFy.startYear - 2, currentFy.startYear - 1, currentFy.startYear].map((y) => (
              <option key={y} value={y}>
                FY {fiscalYearOf(new Date(y, clinic.fyStartMonth - 1, 1), clinic.fyStartMonth).label}
              </option>
            ))}
          </select>
          <select className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                {monthName(m.month)} {m.year}
              </option>
            ))}
          </select>
          <button className={btnSecondary} onClick={downloadCsv}>
            Export CSV
          </button>
          <Link
            to="/reports/print"
            search={{ year: selected.year, month: selected.month }}
            className={btnSecondary}
          >
            Export as PDF
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
        <MonthlyReportTable
          report={report}
          hospitalSplit={hospitalSplit}
          showShared={therapistSplit}
          own={labels.own}
          partner={labels.partner}
        />
      </div>

      <p className="text-xs text-[var(--muted)]">
        Patients = unique patients in the month, not visit count.
        {hospitalSplit && (
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

      {hospitalSplit && (
        <SettlementCard
          clinicId={clinic.id}
          month={selected}
          expectedPaise={report?.total.postTaxPaise ?? null}
          labels={labels}
        />
      )}
    </div>
  );
}

function SettlementCard({
  clinicId,
  month,
  expectedPaise,
  labels,
}: {
  clinicId: string;
  month: FyMonth;
  expectedPaise: Paise | null;
  labels: { own: string; partner: string };
}) {
  const settlement = useLiveQuery(
    () => settlementService.get(clinicId, month.year, month.month),
    [clinicId, month.year, month.month]
  );

  const [amountPaise, setAmountPaise] = useState<Paise | null>(null);
  const [receivedDate, setReceivedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAmountPaise(settlement?.amountReceivedPaise ?? null);
    setReceivedDate(settlement?.receivedDate ?? '');
    setNotes(settlement?.notes ?? '');
    setSaved(false);
  }, [settlement, month.year, month.month]);

  async function save() {
    setError(null);
    try {
      await settlementService.save(clinicId, month.year, month.month, {
        amountReceivedPaise: amountPaise ?? 0,
        receivedDate: receivedDate || null,
        notes: notes || null,
      });
      setSaved(true);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  const variancePaise = amountPaise != null && expectedPaise != null ? amountPaise - expectedPaise : null;

  return (
    <SectionCard title={`${labels.partner} settlement — ${monthName(month.month)} ${month.year}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label={`Expected (computed Post Tax ${labels.own})${expectedPaise == null ? '' : `: ${formatINR(expectedPaise)}`}`}>
          <div className="rounded-md border border-[var(--border)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)]">
            {expectedPaise != null ? formatINR(expectedPaise) : '—'}
          </div>
        </Field>
        <Field label={`Amount received from ${labels.partner}`}>
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
      {variancePaise != null && (
        <p
          className={`mt-3 text-sm font-medium ${
            variancePaise === 0
              ? 'text-[var(--moss)]'
              : Math.abs(variancePaise) < 100
                ? 'text-[var(--rust)]'
                : 'text-[var(--rust)]'
          }`}
        >
          Variance: {variancePaise >= 0 ? '+' : ''}
          {formatINR(variancePaise)}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button className={btnPrimary} onClick={() => void save()}>
          Save settlement
        </button>
        {saved && <span className="text-sm text-[var(--moss)]">Saved ✓</span>}
      </div>
      <ErrorNote message={error} />
    </SectionCard>
  );
}
