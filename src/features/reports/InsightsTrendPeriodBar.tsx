import type { Clinic } from '@/domain/types';
import type { FyMonth } from '@/domain/fiscalYear';
import type { InsightsTrendPeriodMode } from './insightsTrendPeriod';

const PERIOD_OPTIONS: { key: InsightsTrendPeriodMode; label: string }[] = [
  { key: '6m', label: '6m' },
  { key: 'ytd', label: 'YTD' },
  { key: 'fy', label: 'FY' },
];

export function InsightsTrendPeriodBar({
  mode,
  onModeChange,
  periodCaption,
}: {
  clinic: Clinic;
  mode: InsightsTrendPeriodMode;
  onModeChange: (mode: InsightsTrendPeriodMode) => void;
  momFocus: FyMonth;
  onMomFocusChange: (m: FyMonth) => void;
  periodCaption: string;
}) {
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
              className="rounded-full border px-3 py-1 text-xs font-medium cursor-pointer transition-colors"
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
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">{periodCaption}</p>
    </div>
  );
}
