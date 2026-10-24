import { useMemo, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { attributionAuditService, repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { fiscalYearOf, monthsOfFiscalYear, monthName, formatDateDMY } from '@/domain/fiscalYear';
import { clinicShareLabels } from '@/domain/types';
import {
  MECHANISM_LABEL,
  basisText,
  filterEntries,
  summarize,
  toAuditCsv,
} from './attributionAuditView';
import { inputCls, th, thNum, td, tdNum } from '@/components/ui';

/**
 * Per-transaction detail behind reportService's aggregate Shared/Net
 * figures — every rupee a revenue share, a legacy manual split or automatic package attribution
 * moved between therapists this month, with the patient/visit/therapist
 * it came from. Exists so a disputed monthly number can be traced back to
 * the specific visit(s) that produced it, rather than taken on faith.
 */
const sectionTitle = 'text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]';

export function AttributionAuditPage() {
  const clinic = useClinic();
  const labels = clinicShareLabels(clinic);
  const currentFy = fiscalYearOf(new Date(), clinic.fyStartMonth);
  // Arriving from the Monthly Statement's "see the attribution audit" link
  // carries the month it was viewing (?year=&month=) so the two stay in
  // sync; landing here directly (nav tab) falls back to the current month.
  const linkedMonth = useSearch({
    from: '/insights',
    select: (s) => ({ year: s.year, month: s.month, therapist: s.therapist }),
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

  const [therapistFilter, setTherapistFilter] = useState(linkedMonth.therapist ?? '');
  const [query, setQuery] = useState('');
  const allEntries = useLiveQuery(
    () => attributionAuditService.monthly(clinic.id, selected),
    [clinic.id, selected.year, selected.month]
  );
  const patients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const patientName = new Map((patients ?? []).map((p) => [p.id, `${p.name} (${p.mrno})`]));
  const therapistName = new Map((therapists ?? []).map((t) => [t.id, t.name]));
  const nameOf = (id: string) => therapistName.get(id) ?? 'Unknown';
  const patientLabel = (id: string) => patientName.get(id) ?? '—';
  const entries = useMemo(
    () =>
      allEntries &&
      filterEntries(allEntries, { therapistId: therapistFilter, query, patientName: patientLabel }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allEntries, therapistFilter, query, patients]
  );
  const summary = useMemo(() => (entries ? summarize(entries) : []), [entries]);

  function downloadCsv() {
    if (!entries) return;
    const blob = new Blob([toAuditCsv(entries, nameOf, patientLabel)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clinic.invoicePrefix}-attribution-${selected.year}-${String(selected.month).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--border)] pb-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-[var(--ink)]">
            Attribution audit
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Every rupee that moved between therapists this month: revenue shares, manual splits and
            package sessions. The detail behind the Shared and Net columns of the Monthly statement.
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

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--paper)] p-2.5">
        <select
          aria-label="Therapist"
          className={`${inputCls} !w-auto min-w-[10rem]`}
          value={therapistFilter}
          onChange={(e) => setTherapistFilter(e.target.value)}
        >
          <option value="">All therapists</option>
          {(therapists ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label="Search patient"
          placeholder="Search patient"
          className={`${inputCls} !w-auto min-w-[10rem] flex-1 sm:max-w-[16rem] sm:flex-none`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="ml-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper)] disabled:opacity-40"
          disabled={!entries || entries.length === 0}
          onClick={downloadCsv}
        >
          Download CSV
        </button>
      </div>

      {summary.length > 0 && (
        <section className="space-y-2">
          <h3 className={sectionTitle}>Summary by therapist</h3>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--paper)]">
                <tr>
                  <th className={th}>Therapist</th>
                  <th className={thNum}>Gave</th>
                  <th className={thNum}>Received</th>
                  <th className={thNum}>Net change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {summary.map((r) => (
                  <tr key={r.therapistId}>
                    <td className={td}>{nameOf(r.therapistId)}</td>
                    <td className={tdNum}>{r.given ? formatINR(r.given) : '—'}</td>
                    <td className={tdNum}>{r.received ? formatINR(r.received) : '—'}</td>
                    <td className={`${tdNum} font-semibold`}>{formatINR(r.received - r.given)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {entries && entries.length === 0 && (
        <p className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-8 text-center text-sm text-[var(--muted)]">
          {allEntries && allEntries.length > 0
            ? 'Nothing matches this filter.'
            : 'No money moved between therapists this month.'}
        </p>
      )}

      {entries && entries.length > 0 && (
        <section className="space-y-2">
          <h3 className={sectionTitle}>
            Credits and debits{' '}
            <span className="font-normal normal-case tracking-normal">· {entries.length}</span>
          </h3>
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
                  {MECHANISM_LABEL[e.mechanism]}
                  {e.repaired ? ' (repaired)' : ''} · {basisText(e, nameOf)}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden tab:block overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
            <div className="overflow-x-auto overscroll-x-contain">
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
                <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
                  {entries.map((e, i) => (
                    <tr
                      key={`${e.visitId}-${e.toTherapistId}-${i}`}
                      className="hover:bg-[var(--paper)]/50 transition-colors"
                    >
                      <td className={td}>{formatDateDMY(e.visitDate)}</td>
                      <td className={`${td} font-medium`}>{patientName.get(e.patientId) ?? '—'}</td>
                      <td className={td}>{therapistName.get(e.fromTherapistId) ?? 'Unknown'}</td>
                      <td className={td}>{therapistName.get(e.toTherapistId) ?? 'Unknown'}</td>
                      <td className={td}>
                        {e.mechanism === 'package_attribution' ? (
                          <span className="rounded-full bg-[var(--teal-light)] px-2 py-0.5 text-[10px] font-semibold text-[var(--teal-strong)]">
                            {MECHANISM_LABEL[e.mechanism]}
                          </span>
                        ) : (
                          <span className="rounded-full bg-[var(--amber-light)] px-2 py-0.5 text-[10px] font-semibold text-[#b45309]">
                            {MECHANISM_LABEL[e.mechanism]}
                          </span>
                        )}
                        {e.repaired && (
                          <span
                            className="ml-1 text-[10px] font-semibold text-[#b45309]"
                            title="The visit's saved shares were incomplete (no row for the primary, a negative share, or not adding up to the bill), so they were recalculated from its services for this report."
                          >
                            Repaired
                          </span>
                        )}
                      </td>
                      <td className={`${td} text-[var(--muted)]`}>{basisText(e, nameOf)}</td>
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
                      <td className={`${tdNum} font-semibold text-[var(--ink)]`}>
                        {formatINR(e.postTaxPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-[var(--border)] bg-[var(--paper)] font-semibold text-sm">
                  <tr>
                    <td className={`${td} font-bold text-[var(--ink)]`} colSpan={6}>
                      Total Reallocated ({entries.length} entries)
                    </td>
                    <td className={`${tdNum} font-bold text-[var(--ink)]`}>
                      {formatINR(entries.reduce((s, e) => s + (e.grossPaise ?? 0), 0))}
                    </td>
                    <td className={`${tdNum} font-bold text-[var(--ink)]`}>
                      {formatINR(entries.reduce((s, e) => s + e.postTaxPaise, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
