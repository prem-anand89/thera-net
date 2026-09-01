import { useMemo, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { attributionAuditService, repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { fiscalYearOf, monthsOfFiscalYear, monthName, formatDateDMY } from '@/domain/fiscalYear';
import { clinicShareLabels } from '@/domain/types';
import { inputCls, th, thNum, td, tdNum } from '@/components/ui';

/**
 * Per-transaction detail behind reportService's aggregate Shared/Net
 * figures — every rupee a manual split or automatic package attribution
 * moved between therapists this month, with the patient/visit/therapist
 * it came from. Exists so a disputed monthly number can be traced back to
 * the specific visit(s) that produced it, rather than taken on faith.
 */
export function AttributionAuditPage() {
  const clinic = useClinic();
  const labels = clinicShareLabels(clinic);
  const currentFy = fiscalYearOf(new Date(), clinic.fyStartMonth);
  // Arriving from the Monthly Statement's "see the attribution audit" link
  // carries the month it was viewing (?year=&month=) so the two stay in
  // sync; landing here directly (nav tab) falls back to the current month.
  const linkedMonth = useSearch({
    from: '/insights',
    select: (s) => ({ year: s.year, month: s.month }),
  });
  const now = new Date();
  const [fyStartYear, setFyStartYear] = useState(
    linkedMonth.year
      ? fiscalYearOf(
          new Date(linkedMonth.year, (linkedMonth.month ?? 1) - 1, 1),
          clinic.fyStartMonth
        ).startYear
      : currentFy.startYear
  );
  const [month, setMonth] = useState(
    linkedMonth.year && linkedMonth.month
      ? `${linkedMonth.year}-${linkedMonth.month}`
      : `${now.getFullYear()}-${now.getMonth() + 1}`
  );

  const months = useMemo(
    () => monthsOfFiscalYear(fyStartYear, clinic.fyStartMonth),
    [fyStartYear, clinic.fyStartMonth]
  );
  const selected = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return { year: y, month: m };
  }, [month]);

  const entries = useLiveQuery(
    () => attributionAuditService.monthly(clinic.id, selected),
    [clinic.id, selected.year, selected.month]
  );
  const patients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const patientName = new Map((patients ?? []).map((p) => [p.id, `${p.name} (${p.mrno})`]));
  const therapistName = new Map((therapists ?? []).map((t) => [t.id, t.name]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-[var(--ink)]">
            Attribution audit
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Every rupee moved between therapists this month via a manual split or a package's
            session-attribution — the detail behind the Shared/Net columns above.
          </p>
        </div>
        <div className="ml-auto flex items-end gap-2">
          <select
            className={inputCls}
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
          <select className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                {monthName(m.month)} {m.year}
              </option>
            ))}
          </select>
        </div>
      </div>

      {entries && entries.length === 0 && (
        <p className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-8 text-center text-sm text-[var(--muted)]">
          No money moved between therapists this month.
        </p>
      )}

      {entries && entries.length > 0 && (
        <>
          {/* Below tab: — boxed cards instead of forcing this 8-column
              table to scroll sideways on a phone. */}
          <div className="tab:hidden space-y-2">
            {entries.map((e, i) => (
              <div
                key={`${e.visitId}-${e.toTherapistId}-${i}`}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-display text-sm font-medium text-[var(--ink)]">
                      {patientName.get(e.patientId) ?? '—'}
                    </div>
                    <div className="text-xs text-[var(--muted)]">{formatDateDMY(e.visitDate)}</div>
                  </div>
                  <div
                    className="shrink-0 text-right"
                    title={
                      e.grossPaise == null
                        ? 'No gross figure for package attribution — the continuation session was billed at ₹0; only the Post-Tax share (from the billing visit) moves.'
                        : undefined
                    }
                  >
                    <div className="font-num text-sm font-medium text-[var(--ink)]">
                      {formatINR(e.postTaxPaise)}
                    </div>
                    <div className="font-num text-xs text-[var(--muted)]">
                      Gross {e.grossPaise != null ? formatINR(e.grossPaise) : '—'}
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-[var(--ink)]">
                  <span className="text-[var(--muted)]">From</span>{' '}
                  {therapistName.get(e.fromTherapistId) ?? 'Unknown'}{' '}
                  <span className="text-[var(--muted)]">→</span>{' '}
                  {therapistName.get(e.toTherapistId) ?? 'Unknown'}
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  {e.mechanism === 'manual_split' ? 'Manual split' : 'Package attribution'} ·{' '}
                  {e.mechanism === 'manual_split'
                    ? `${e.sharedPct}% of ${formatINR(e.visitBillPaise ?? 0)} bill`
                    : `Session ${e.sessionIndex ?? '?'} of ${e.packageSessionCount ?? '?'} · ${formatINR(e.packageTotalPaise ?? 0)} package`}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden tab:block overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <table className="min-w-full divide-y divide-[var(--border)]">
              <thead className="bg-[var(--paper)]">
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Patient</th>
                  <th className={th}>From</th>
                  <th className={th}>To</th>
                  <th className={th}>Mechanism</th>
                  <th className={th}>Basis</th>
                  <th className={thNum}>Gross</th>
                  <th className={thNum}>Post-Tax {labels.own}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {entries.map((e, i) => (
                  <tr key={`${e.visitId}-${e.toTherapistId}-${i}`}>
                    <td className={td}>{formatDateDMY(e.visitDate)}</td>
                    <td className={td}>{patientName.get(e.patientId) ?? '—'}</td>
                    <td className={td}>{therapistName.get(e.fromTherapistId) ?? 'Unknown'}</td>
                    <td className={td}>{therapistName.get(e.toTherapistId) ?? 'Unknown'}</td>
                    <td className={td}>
                      {e.mechanism === 'manual_split' ? 'Manual split' : 'Package attribution'}
                    </td>
                    <td className={`${td} text-[var(--muted)]`}>
                      {e.mechanism === 'manual_split'
                        ? `${e.sharedPct}% of ${formatINR(e.visitBillPaise ?? 0)} bill`
                        : `Session ${e.sessionIndex ?? '?'} of ${e.packageSessionCount ?? '?'} · ${formatINR(e.packageTotalPaise ?? 0)} package`}
                    </td>
                    <td
                      className={tdNum}
                      title={
                        e.grossPaise == null
                          ? 'No gross figure for package attribution — the continuation session was billed at ₹0; only the Post-Tax share (from the billing visit) moves.'
                          : undefined
                      }
                    >
                      {e.grossPaise != null ? formatINR(e.grossPaise) : '—'}
                    </td>
                    <td className={tdNum}>{formatINR(e.postTaxPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
