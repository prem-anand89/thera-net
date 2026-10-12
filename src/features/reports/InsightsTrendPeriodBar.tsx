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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3.5 mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--paper)] px-3 py-1 text-xs font-semibold text-[var(--ink)] shadow-2xs">
          <span className="text-[var(--teal)]" aria-hidden="true">📅</span>
          <span>{periodCaption}</span>
        </div>

        <div
          className="flex items-center rounded-full border border-[var(--border)] bg-[var(--paper)] p-0.5"
          role="group"
          aria-label="Trend period"
        >
          {PERIOD_OPTIONS.map((opt) => {
            const active = mode === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                aria-pressed={active}
                onClick={() => onModeChange(opt.key)}
                className={`min-h-7 rounded-full px-3 py-0.5 text-xs font-medium cursor-pointer transition-colors ${
                  active
                    ? 'bg-[var(--surface)] text-[var(--ink)] font-semibold shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-[var(--muted)]">
        Applies to revenue trend &amp; therapist comparison
      </p>
    </div>
  );
}
