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
  hoveredIndex = null,
  onHoverIndex,
}: {
  categories: string[];
  fullCategories?: string[];
  revenuePaise: number[];
  formatRevenue: (paise: number) => string;
  currentMonthIndices?: number[];
  selectedIndex?: number | null;
  onSelectIndex?: (index: number | null) => void;
  hoveredIndex?: number | null;
  onHoverIndex?: (index: number | null) => void;
}) {
  const [chartMode, setChartMode] = useState<'volume' | 'growth'>('volume');
  const [localHovered, setLocalHovered] = useState<number | null>(null);
  const activeHover = hoveredIndex ?? localHovered;
  const activeIdx =
    activeHover ?? selectedIndex ?? (revenuePaise.length > 0 ? revenuePaise.length - 1 : 0);

  const activeValue = revenuePaise[activeIdx] ?? 0;
  const previousValue = activeIdx > 0 ? revenuePaise[activeIdx - 1] : 0;
  const activeDelta = activeIdx > 0 ? activeValue - previousValue : null;
  const deltaPct = activeIdx > 0 ? pctChange(activeValue, previousValue) : null;

  const maxVal = Math.max(1, ...revenuePaise);

  // Month-over-month deltas calculation
  const deltas = revenuePaise.map((val, i) => (i > 0 ? val - revenuePaise[i - 1] : null));
  const maxAbsDelta = Math.max(
    1,
    ...deltas.filter((d): d is number => d != null).map(Math.abs)
  );

  const width = 360;
  const height = 180;
  const paddingX = 14;
  const paddingTop = 18;
  const baseline = 145;
  const plotH = baseline - paddingTop;
  const plotW = width - paddingX * 2;
  const count = categories.length;
  const groupW = count > 0 ? plotW / count : plotW;
  const barW = Math.max(8, Math.min(22, groupW - 6));
  const y0 = paddingTop + plotH / 2; // zero-line for growth mode

  const labelFor = (i: number) => fullCategories?.[i] ?? categories[i];

  return (
    <div className="chart-panel flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xs">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {chartMode === 'volume' ? 'Monthly Revenue' : 'MoM Revenue Growth'}
            </span>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              {chartMode === 'volume' ? (
                <>
                  <span className="font-num text-lg font-medium text-[var(--ink)]">
                    {formatRevenue(activeValue)}
                  </span>
                  {deltaPct != null && (
                    <span
                      className={`font-num whitespace-nowrap text-xs font-semibold ${
                        deltaPct >= 0 ? 'text-[var(--teal)]' : 'text-[var(--rust)]'
                      }`}
                    >
                      {deltaPct >= 0 ? `▲ +${deltaPct}%` : `▼ ${Math.abs(deltaPct)}%`} vs prior
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span
                    className={`font-num text-lg font-medium ${
                      activeDelta == null || activeDelta === 0
                        ? 'text-[var(--ink)]'
                        : activeDelta > 0
                          ? 'text-[var(--teal)]'
                          : 'text-[var(--rust)]'
                    }`}
                  >
                    {activeDelta != null
                      ? `${activeDelta >= 0 ? '+' : '−'}${formatRevenue(Math.abs(activeDelta))}`
                      : '—'}
                  </span>
                  {deltaPct != null && (
                    <span
                      className={`font-num whitespace-nowrap text-xs font-semibold ${
                        deltaPct >= 0 ? 'text-[var(--teal)]' : 'text-[var(--rust)]'
                      }`}
                    >
                      ({deltaPct >= 0 ? `+${deltaPct}%` : `${deltaPct}%`}) vs prior
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Mode Toggle: Revenue vs MoM Growth */}
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--paper)] p-0.5">
              <button
                type="button"
                onClick={() => setChartMode('volume')}
                className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                  chartMode === 'volume'
                    ? 'bg-[var(--surface)] text-[var(--ink)] font-semibold shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                Revenue
              </button>
              <button
                type="button"
                onClick={() => setChartMode('growth')}
                className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                  chartMode === 'growth'
                    ? 'bg-[var(--surface)] text-[var(--ink)] font-semibold shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                MoM Growth
              </button>
            </div>

            <span className="whitespace-nowrap rounded-full bg-[var(--paper)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
              {labelFor(activeIdx)}
            </span>
          </div>
        </div>
      </div>

      <div className="relative mt-3">
        {/* Floating tooltip above hovered bar */}
        {activeHover != null && (
          <div
            className="pointer-events-none absolute -top-3 z-20 -translate-x-1/2 rounded-md bg-[var(--ink)] px-2 py-0.5 text-[11px] font-semibold text-[var(--paper)] shadow-md transition-all whitespace-nowrap"
            style={{
              left: `${((paddingX + activeHover * groupW + groupW / 2) / width) * 100}%`,
            }}
          >
            {chartMode === 'volume'
              ? `${labelFor(activeHover)}: ${formatRevenue(revenuePaise[activeHover] ?? 0)}`
              : deltas[activeHover] != null
                ? `${labelFor(activeHover)}: ${deltas[activeHover]! >= 0 ? '+' : '−'}${formatRevenue(Math.abs(deltas[activeHover]!))}`
                : `${labelFor(activeHover)}: Baseline`}
          </div>
        )}

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-44 w-full overflow-visible"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Baseline rule */}
          <line
            x1={paddingX}
            y1={chartMode === 'volume' ? baseline : y0}
            x2={width - paddingX}
            y2={chartMode === 'volume' ? baseline : y0}
            stroke="var(--border)"
            strokeWidth={chartMode === 'volume' ? 1 : 1.5}
            strokeDasharray={chartMode === 'volume' ? 'none' : '3 2'}
          />

          {chartMode === 'volume'
            ? /* VOLUME MODE BARS */
              revenuePaise.map((val, i) => {
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
              })
            : /* MOM GROWTH MODE BARS */
              deltas.map((d, i) => {
                const isSelected = i === activeIdx;
                const centerX = paddingX + i * groupW + groupW / 2;
                const barX = centerX - barW / 2;
                const isPositive = d != null && d >= 0;
                const h =
                  d != null && d !== 0
                    ? Math.max(6, Math.round((Math.abs(d) / maxAbsDelta) * (plotH / 2 - 8)))
                    : 0;
                const y = isPositive ? y0 - h : y0;

                return (
                  <g key={`growth-bar-${categories[i]}-${i}`}>
                    {/* Column highlight */}
                    {isSelected && (
                      <rect
                        x={centerX - groupW / 2 + 1}
                        y={paddingTop - 4}
                        width={groupW - 2}
                        height={plotH + 8}
                        rx="4"
                        fill={isPositive ? 'var(--teal)' : 'var(--rust)'}
                        opacity="0.08"
                      />
                    )}

                    {d != null && d !== 0 ? (
                      <rect
                        x={barX}
                        y={y}
                        width={barW}
                        height={h}
                        rx="3"
                        fill={isPositive ? 'var(--teal)' : 'var(--rust)'}
                        opacity={isSelected ? 1 : 0.7}
                        className="transition-all hover:opacity-90"
                      />
                    ) : (
                      <rect
                        x={barX}
                        y={y0 - 1}
                        width={barW}
                        height="2"
                        rx="1"
                        fill="var(--muted)"
                        opacity="0.4"
                      />
                    )}

                    {isSelected && d != null && d !== 0 && (
                      <circle
                        cx={centerX}
                        cy={isPositive ? Math.max(6, y - 5) : Math.min(baseline, y + h + 5)}
                        r="2.5"
                        fill={isPositive ? 'var(--teal)' : 'var(--rust)'}
                      />
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
              onMouseEnter={() => {
                setLocalHovered(i);
                onHoverIndex?.(i);
              }}
              onMouseLeave={() => {
                setLocalHovered(null);
                onHoverIndex?.(null);
              }}
              className="flex-1 cursor-pointer focus:outline-none focus:ring-0 focus-visible:outline-none"
              title={`${labelFor(i)}: ${formatRevenue(revenuePaise[i])}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
