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
  const linkedMonth = useSearch({ from: '/insights', select: (s) => ({ year: s.year, month: s.month }) });
  const now = new Date();
  const [fyStartYear, setFyStartYear] = useState(
    linkedMonth.year ? fiscalYearOf(new Date(linkedMonth.year, (linkedMonth.month ?? 1) - 1, 1), clinic.fyStartMonth).startYear : currentFy.startYear
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
          <h2 className="font-display text-base font-semibold text-[var(--ink)]">Attribution audit</h2>
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
        </div>
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--paper)]">
            <tr>
              <th className={th}>Date</th>
              <th className={th}>Patient</th>
              <th className={th}>From</th>
              <th className={th}>To</th>
              <th className={th}>Mechanism</th>
              <th className={thNum}>Gross</th>
              <th className={thNum}>Post-Tax {labels.own}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {(entries ?? []).map((e, i) => (
              <tr key={`${e.visitId}-${e.toTherapistId}-${i}`}>
                <td className={td}>{formatDateDMY(e.visitDate)}</td>
                <td className={td}>{patientName.get(e.patientId) ?? '—'}</td>
                <td className={td}>{therapistName.get(e.fromTherapistId) ?? 'Unknown'}</td>
                <td className={td}>{therapistName.get(e.toTherapistId) ?? 'Unknown'}</td>
                <td className={td}>
                  {e.mechanism === 'manual_split' ? 'Manual split' : 'Package attribution'}
                </td>
                <td className={tdNum}>{e.grossPaise != null ? formatINR(e.grossPaise) : '—'}</td>
                <td className={tdNum}>{formatINR(e.postTaxPaise)}</td>
              </tr>
            ))}
            {entries && entries.length === 0 && (
              <tr>
                <td className={`${td} text-center text-[var(--muted)]`} colSpan={7}>
                  No money moved between therapists this month.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
