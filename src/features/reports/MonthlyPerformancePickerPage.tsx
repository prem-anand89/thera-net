import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useClinic } from '@/app/clinicContext';
import { fiscalYearOf, monthsOfFiscalYear, monthName } from '@/domain/fiscalYear';
import { inputCls, btnPrimary, SectionCard } from '@/components/ui';

/**
 * Just the month/FY picker plus a link into the print page — same shape as
 * MonthlyStatementPage's own picker bar, minus the on-screen table (this
 * report is print-only, per its own scope: a team-review handout, not a
 * daily-use screen).
 */
export function MonthlyPerformancePickerPage() {
  const clinic = useClinic();
  const currentFy = fiscalYearOf(new Date(), clinic.fyStartMonth);
  const [fyStartYear, setFyStartYear] = useState(currentFy.startYear);
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${now.getMonth() + 1}`);

  const months = monthsOfFiscalYear(fyStartYear, clinic.fyStartMonth);
  const [selectedYear, selectedMonth] = month.split('-').map(Number);

  return (
    <SectionCard title="Monthly performance report">
      <p className="mb-3 text-sm text-[var(--muted)]">
        Clinic totals, per-therapist breakdown, referral/condition mix, and retention follow-ups for
        one month — printable to review with the team.
      </p>
      <div className="flex flex-wrap items-end gap-2">
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
        <Link
          to="/insights/performance-print"
          search={{ year: selectedYear, month: selectedMonth }}
          className={btnPrimary}
        >
          Print performance report
        </Link>
      </div>
    </SectionCard>
  );
}
