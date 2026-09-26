import { useState } from 'react';
import { monthOverMonthDelta } from '@/components/chartTrendMath';

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

const UP = 'var(--moss)';
const DOWN = 'var(--rust)';

export function RevenueWaterfallChart({
  categories,
  fullCategories,
  revenuePaise,
  formatValue,
  compact = false,
  selectedCategoryIndex = null,
  onCategoryHover,
}: {
  categories: string[];
  fullCategories?: string[];
  revenuePaise: number[];
  formatValue: (paise: number) => string;
  compact?: boolean;
  selectedCategoryIndex?: number | null;
  onCategoryHover?: (index: number | null) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const active = selectedCategoryIndex ?? hovered;

  if (categories.length === 0) {
    return <p className="py-6 text-center text-sm text-[var(--muted)]">No data to chart.</p>;
  }

  const deltas = monthOverMonthDelta(revenuePaise);
  const width = 640;
  const height = compact ? 188 : 200;
  const padding = compact
    ? { top: 20, right: 6, bottom: 26, left: 32 }
    : { top: 22, right: 10, bottom: 28, left: 40 };
  const labelFor = (i: number) => fullCategories?.[i] ?? categories[i];
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const baseline = padding.top + plotH;
  const y0 = baseline - plotH / 2;
  const maxAbs = niceMax(Math.max(1, ...deltas.filter((d): d is number => d != null).map(Math.abs)));
  const yFor = (delta: number) => y0 - (delta / maxAbs) * (plotH / 2 - 8);
  const groupW = plotW / categories.length;
  const barW = Math.min(compact ? 20 : 26, groupW * 0.5);

  const setActive = (i: number | null) => {
    setHovered(i);
    onCategoryHover?.(i);
  };

  const indexFromEvent = (clientX: number, rect: DOMRect) => {
    const x = ((clientX - rect.left) / rect.width) * width;
    const ci = Math.floor((x - padding.left) / groupW);
    if (ci < 0 || ci >= categories.length) return null;
    return ci;
  };

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none"
        role="img"
        aria-label="Revenue change from prior month"
        onPointerLeave={() => setActive(null)}
        onPointerMove={(e) => {
          const i = indexFromEvent(e.clientX, e.currentTarget.getBoundingClientRect());
          if (i != null) setActive(i);
        }}
      >
        <text x={padding.left} y={12} className="fill-slate-400" fontSize={8}>
          ₹ change
        </text>
        <line
          x1={padding.left}
          y1={y0}
          x2={padding.left + plotW}
          y2={y0}
          stroke="#cbd5e1"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        {categories.map((cat, ci) => {
          const groupX = padding.left + ci * groupW;
          const cx = groupX + groupW / 2;
          const delta = deltas[ci];
          const isActive = active === ci;
          const dim = active != null && !isActive;

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
              {ci > 0 && delta != null && delta !== 0 && (
                <>
                  <line
                    x1={padding.left + (ci - 1) * groupW + groupW / 2 + barW / 2}
                    y1={y0}
                    x2={cx - barW / 2}
                    y2={y0}
                    stroke="#e2e2e1"
                    strokeWidth={1}
                  />
                  <path
                    d={roundedTopRectPath(
                      cx - barW / 2,
                      delta > 0 ? yFor(delta) : y0,
                      barW,
                      Math.max(3, Math.abs(y0 - yFor(delta))),
                      3
                    )}
                    fill={delta > 0 ? UP : DOWN}
                    opacity={dim ? 0.4 : 1}
                  />
                  {isActive && (
                    <text
                      x={cx}
                      y={delta > 0 ? yFor(delta) - 5 : y0 + Math.abs(y0 - yFor(delta)) + 12}
                      textAnchor="middle"
                      fontSize={8}
                      fontWeight={600}
                      fill={delta > 0 ? UP : DOWN}
                    >
                      {delta > 0 ? '+' : '−'}
                      {formatValue(Math.abs(delta))}
                    </text>
                  )}
                </>
              )}
              {ci === 0 && (
                <text x={cx} y={baseline + 14} textAnchor="middle" className="fill-slate-400" fontSize={8}>
                  start
                </text>
              )}
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
            compact ? 'bottom-1 left-2 right-2' : 'left-1/2 top-0 -translate-x-1/2'
          }`}
          style={compact ? undefined : { marginTop: 4 }}
        >
          <div className="font-medium">{labelFor(active)}</div>
          <div className="mt-0.5 tabular-nums">
            {revenuePaise[active] > 0 ? formatValue(revenuePaise[active]) : '—'}
            {deltas[active] != null && deltas[active] !== 0 && (
              <span className="ml-2" style={{ color: deltas[active]! > 0 ? '#8fd4a8' : '#f0a898' }}>
                {deltas[active]! > 0 ? '+' : '−'}
                {formatValue(Math.abs(deltas[active]!))} vs prior
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
