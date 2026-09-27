import { useState } from 'react';
import { fiscalYearOf, monthsOfFiscalYear, monthName } from '@/domain/fiscalYear';
import type { Clinic } from '@/domain/types';
import { inputCls } from '@/components/ui';
import type { FyMonth } from '@/domain/fiscalYear';
import type { InsightsTrendPeriodMode } from './insightsTrendPeriod';

const PERIOD_OPTIONS: { key: InsightsTrendPeriodMode; label: string }[] = [
  { key: 'mom', label: 'MoM' },
  { key: '6m', label: '6m' },
  { key: 'ytd', label: 'YTD' },
  { key: 'fy', label: 'FY' },
];

/** Keep FY dropdown aligned when focus month moves from outside (URL). */
function useFyStartYearForPicker(momFocus: FyMonth, fyStartMonth: number): [number, (y: number) => void] {
  const fy = fiscalYearOf(new Date(momFocus.year, momFocus.month - 1, 1), fyStartMonth);
  const [manual, setManual] = useState<number | null>(null);
  const fyStartYear = manual ?? fy.startYear;
  return [fyStartYear, setManual];
}

export function InsightsTrendPeriodBar({
  clinic,
  mode,
  onModeChange,
  momFocus,
  onMomFocusChange,
  periodCaption,
}: {
  clinic: Clinic;
  mode: InsightsTrendPeriodMode;
  onModeChange: (mode: InsightsTrendPeriodMode) => void;
  momFocus: FyMonth;
  onMomFocusChange: (m: FyMonth) => void;
  periodCaption: string;
}) {
  const currentFy = fiscalYearOf(new Date(), clinic.fyStartMonth);
  const [fyStartYear, setFyStartYear] = useFyStartYearForPicker(momFocus, clinic.fyStartMonth);
  const months = monthsOfFiscalYear(fyStartYear, clinic.fyStartMonth);
  const monthValue = `${momFocus.year}-${momFocus.month}`;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 shadow-sm sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          Trend period
        </span>
        <div className="flex flex-wrap gap-1.5">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => onModeChange(opt.key)}
              className="rounded-full border px-3 py-1 text-xs font-medium"
              style={{
                background: mode === opt.key ? 'var(--teal-light)' : 'var(--paper)',
                borderColor: mode === opt.key ? 'transparent' : 'var(--border)',
                color: mode === opt.key ? 'var(--teal)' : 'var(--muted)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {mode === 'mom' && (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <select
              className={`${inputCls} !w-auto min-w-0 py-1.5 text-sm`}
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
              className={`${inputCls} !w-auto min-w-0 py-1.5 text-sm`}
              value={monthValue}
              onChange={(e) => {
                const [y, m] = e.target.value.split('-').map(Number);
                onMomFocusChange({ year: y, month: m });
              }}
            >
              {months.map((m) => (
                <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                  {monthName(m.month)} {m.year}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">{periodCaption}</p>
    </div>
  );
}
