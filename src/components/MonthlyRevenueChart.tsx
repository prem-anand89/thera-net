import { useState } from 'react';

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function MonthlyRevenueChart({
  categories,
  fullCategories,
  revenuePaise,
  formatRevenue,
  currentMonthIndices = [],
  selectedIndex = null,
  onSelectIndex,
}: {
  categories: string[];
  fullCategories?: string[];
  revenuePaise: number[];
  formatRevenue: (paise: number) => string;
  currentMonthIndices?: number[];
  selectedIndex?: number | null;
  onSelectIndex?: (index: number | null) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const activeIdx =
    selectedIndex ?? hovered ?? (revenuePaise.length > 0 ? revenuePaise.length - 1 : 0);

  const activeValue = revenuePaise[activeIdx] ?? 0;
  const previousValue = activeIdx > 0 ? revenuePaise[activeIdx - 1] : 0;
  const deltaPct = activeIdx > 0 ? pctChange(activeValue, previousValue) : null;

  const maxVal = Math.max(1, ...revenuePaise);

  const width = 360;
  const height = 130;
  const paddingX = 14;
  const paddingTop = 16;
  const baseline = 100;
  const plotH = baseline - paddingTop;
  const plotW = width - paddingX * 2;
  const count = categories.length;
  const groupW = count > 0 ? plotW / count : plotW;
  const barW = Math.max(8, Math.min(22, groupW - 6));

  const labelFor = (i: number) => fullCategories?.[i] ?? categories[i];

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xs">
      <div>
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              Monthly Revenue
            </span>
            <div className="mt-1 flex items-baseline gap-2.5">
              <span className="font-num text-2xl font-bold tracking-tight text-[var(--ink)]">
                {formatRevenue(activeValue)}
              </span>
              {deltaPct != null && (
                <span
                  className={`font-num text-xs font-semibold ${
                    deltaPct >= 0 ? 'text-[var(--teal)]' : 'text-[var(--rust)]'
                  }`}
                >
                  {deltaPct >= 0 ? `▲ +${deltaPct}%` : `▼ ${deltaPct}%`} vs prior
                </span>
              )}
            </div>
          </div>
          <span className="rounded-full bg-[var(--paper)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
            {labelFor(activeIdx)}
          </span>
        </div>
      </div>

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-28 w-full overflow-visible"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Baseline rule */}
          <line
            x1={paddingX}
            y1={baseline}
            x2={width - paddingX}
            y2={baseline}
            stroke="var(--border)"
            strokeWidth="1"
          />

          {revenuePaise.map((val, i) => {
            const isSelected = i === activeIdx;
            const isInProgress = currentMonthIndices.includes(i);
            const centerX = paddingX + i * groupW + groupW / 2;
            const barX = centerX - barW / 2;
            const h = val > 0 ? Math.max(6, Math.round((val / maxVal) * plotH)) : 0;
            const y = baseline - h;

            return (
              <g key={`rev-bar-${categories[i]}-${i}`}>
                {/* Column highlight */}
                {isSelected && (
                  <rect
                    x={centerX - groupW / 2 + 1}
                    y={paddingTop - 4}
                    width={groupW - 2}
                    height={plotH + 8}
                    rx="4"
                    fill="var(--teal)"
                    opacity="0.08"
                  />
                )}

                {val > 0 ? (
                  <rect
                    x={barX}
                    y={y}
                    width={barW}
                    height={h}
                    rx="3"
                    fill="var(--teal)"
                    opacity={isSelected ? 1 : 0.65}
                    stroke={isInProgress ? 'var(--ink)' : 'none'}
                    strokeWidth={isInProgress ? 1.5 : 0}
                    strokeDasharray={isInProgress ? '3 2' : 'none'}
                    className="transition-all hover:opacity-90"
                  />
                ) : (
                  <rect
                    x={barX}
                    y={baseline - 2}
                    width={barW}
                    height="2"
                    rx="1"
                    fill="var(--muted)"
                    opacity="0.35"
                  />
                )}

                {isSelected && val > 0 && (
                  <circle cx={centerX} cy={Math.max(6, y - 5)} r="2.5" fill="var(--teal)" />
                )}
              </g>
            );
          })}
        </svg>

        {/* HTML Month labels */}
        <div className="pointer-events-none absolute bottom-0 inset-x-0 flex items-center justify-between px-3">
          {categories.map((cat, i) => {
            const isSelected = i === activeIdx;
            return (
              <span
                key={`cat-rev-${cat}-${i}`}
                className={`text-[10px] transition-colors ${
                  isSelected ? 'font-bold text-[var(--ink)]' : 'font-medium text-[var(--muted)]'
                }`}
              >
                {cat.slice(0, 3)}
              </span>
            );
          })}
        </div>

        {/* Accessible Click / Hover Overlay */}
        <div className="pointer-events-auto absolute inset-0 flex items-stretch">
          {categories.map((cat, i) => (
            <button
              key={`btn-rev-${cat}-${i}`}
              type="button"
              aria-label={`${cat}: ${formatRevenue(revenuePaise[i])}`}
              onClick={() => onSelectIndex?.(i)}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              className="flex-1 cursor-pointer focus:outline-none focus:ring-0 focus-visible:outline-none"
              title={`${labelFor(i)}: ${formatRevenue(revenuePaise[i])}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
