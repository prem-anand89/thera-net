import { useState } from 'react';

function roundedTopRectPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0 || w <= 0) return '';
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + radius} Q${x},${y} ${x + radius},${y} L${x + w - radius},${y} Q${x + w},${y} ${x + w},${y + radius} L${x + w},${y + h} Z`;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / base;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * base;
}

function barLayout(plotW: number, categoryCount: number, compact: boolean) {
  const barGap = compact ? 3 : 4;
  const maxBarW = compact ? 12 : 16;
  const stretchedGroupW = plotW / categoryCount;
  const barW = Math.min(maxBarW, Math.max(6, (stretchedGroupW - barGap * 3) / 2));
  const groupW = barW * 2 + barGap * 3;
  const chartW = groupW * categoryCount;
  const offsetX = (plotW - chartW) / 2;
  return { barGap, barW, groupW, offsetX };
}

export function VisitsRevenueTrendChart({
  categories,
  fullCategories,
  visitCounts,
  revenuePaise,
  visitsColor,
  revenueColor,
  formatRevenue,
  formatVisits = (v) => String(v),
  compact = false,
  currentMonthIndices = [],
  selectedCategoryIndex = null,
  onCategoryHover,
}: {
  categories: string[];
  fullCategories?: string[];
  visitCounts: number[];
  revenuePaise: number[];
  visitsColor: string;
  revenueColor: string;
  formatRevenue: (paise: number) => string;
  formatVisits?: (v: number) => string;
  compact?: boolean;
  /** Months still in progress — dashed outline on bars. */
  currentMonthIndices?: number[];
  selectedCategoryIndex?: number | null;
  onCategoryHover?: (index: number | null) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const active = selectedCategoryIndex ?? hovered;

  if (categories.length === 0) {
    return <p className="py-6 text-center text-sm text-[var(--muted)]">No data to chart.</p>;
  }

  const width = 640;
  const height = compact ? 196 : 210;
  const padding = compact
    ? { top: 22, right: 32, bottom: 26, left: 28 }
    : { top: 24, right: 44, bottom: 28, left: 36 };
  const labelFor = (i: number) => fullCategories?.[i] ?? categories[i];
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const baseline = padding.top + plotH;
  const maxVisits = niceMax(Math.max(1, ...visitCounts));
  const maxRevenue = niceMax(Math.max(1, ...revenuePaise));
  const yVisits = (v: number) => baseline - (v / maxVisits) * plotH;
  const yRevenue = (p: number) => baseline - (p / maxRevenue) * plotH;
  const { barGap, barW, groupW, offsetX } = barLayout(plotW, categories.length, compact);

  const setActive = (i: number | null) => {
    setHovered(i);
    onCategoryHover?.(i);
  };

  const indexFromEvent = (clientX: number, rect: DOMRect) => {
    const x = ((clientX - rect.left) / rect.width) * width;
    const rel = x - padding.left - offsetX;
    const ci = Math.floor(rel / groupW);
    if (ci < 0 || ci >= categories.length) return null;
    return ci;
  };

  return (
    <div className="relative w-full">
      <div className="mb-2 flex flex-wrap gap-4 text-xs font-medium text-[var(--muted)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: visitsColor }} />
          Visits
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: revenueColor }} />
          Revenue
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none"
        role="img"
        aria-label="Monthly visits and revenue"
        onPointerLeave={() => setActive(null)}
        onPointerMove={(e) => {
          const i = indexFromEvent(e.clientX, e.currentTarget.getBoundingClientRect());
          if (i != null) setActive(i);
        }}
      >
        <text x={padding.left} y={12} className="fill-slate-400" fontSize={8}>
          visits
        </text>
        <text x={width - padding.right} y={12} textAnchor="end" className="fill-slate-400" fontSize={8}>
          ₹
        </text>
        {[1, 2, 3].map((i) => {
          const y = padding.top + (plotH * i) / 3;
          return (
            <line
              key={i}
              x1={padding.left}
              y1={y}
              x2={padding.left + plotW}
              y2={y}
              stroke="#f1f5f9"
              strokeWidth={1}
            />
          );
        })}
        <line
          x1={padding.left}
          y1={baseline}
          x2={padding.left + plotW}
          y2={baseline}
          stroke="#e2e8f0"
          strokeWidth={1}
        />
        {categories.map((cat, ci) => {
          const groupX = padding.left + offsetX + ci * groupW;
          const cx = groupX + groupW / 2;
          const isActive = active === ci;
          const dim = active != null && !isActive;
          const inProgress = currentMonthIndices.includes(ci);
          const v = visitCounts[ci] ?? 0;
          const r = revenuePaise[ci] ?? 0;
          const xV = groupX + barGap;
          const xR = groupX + barGap + barW + barGap;

          return (
            <g key={cat}>
              {isActive && (
                <rect
                  x={groupX}
                  y={padding.top}
                  width={groupW}
                  height={plotH}
                  fill="rgba(44, 95, 99, 0.08)"
                />
              )}
              <rect
                x={groupX}
                y={padding.top}
                width={groupW}
                height={plotH}
                fill="transparent"
                className="cursor-pointer"
                onPointerEnter={() => setActive(ci)}
              />
              {v > 0 &&
                (inProgress ? (
                  <rect
                    x={xV}
                    y={yVisits(v)}
                    width={barW}
                    height={baseline - yVisits(v)}
                    rx={2}
                    fill="none"
                    stroke={visitsColor}
                    strokeWidth={2}
                    strokeDasharray="3 2"
                    opacity={dim ? 0.4 : 0.9}
                  />
                ) : (
                  <path
                    d={roundedTopRectPath(xV, yVisits(v), barW, baseline - yVisits(v), 3)}
                    fill={visitsColor}
                    className="bar-grow"
                    opacity={dim ? 0.4 : 0.92}
                  />
                ))}
              {r > 0 &&
                (inProgress ? (
                  <rect
                    x={xR}
                    y={yRevenue(r)}
                    width={barW}
                    height={baseline - yRevenue(r)}
                    rx={2}
                    fill="none"
                    stroke={revenueColor}
                    strokeWidth={2}
                    strokeDasharray="3 2"
                    opacity={dim ? 0.4 : 1}
                  />
                ) : (
                  <path
                    d={roundedTopRectPath(xR, yRevenue(r), barW, baseline - yRevenue(r), 3)}
                    fill={revenueColor}
                    className="bar-grow"
                    opacity={dim ? 0.4 : 1}
                  />
                ))}
              <text
                x={cx}
                y={height - 8}
                textAnchor="middle"
                className={isActive ? 'fill-[var(--teal)]' : 'fill-slate-500'}
                fontSize={compact ? 8 : 9}
                fontWeight={isActive ? 600 : 400}
              >
                {cat}
              </text>
            </g>
          );
        })}
      </svg>
      {active != null && (
        <div
          className={`pointer-events-none absolute z-10 rounded-lg border border-[var(--border)] bg-[var(--ink)] px-3 py-2 text-xs text-[var(--paper)] shadow-md ${
            compact ? 'bottom-1 left-2 right-2 whitespace-normal' : 'left-1/2 top-8 -translate-x-1/2 whitespace-nowrap'
          }`}
        >
          <div className="font-medium">{labelFor(active)}</div>
          <div className="mt-0.5 tabular-nums">
            Visits {formatVisits(visitCounts[active] ?? 0)} ·{' '}
            {revenuePaise[active] > 0 ? formatRevenue(revenuePaise[active]) : '—'}
          </div>
        </div>
      )}
    </div>
  );
}
