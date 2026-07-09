import { useState } from 'react';

/**
 * Minimal SVG bar chart — single or grouped multi-series. No charting
 * library: this app has none, and everything else here is plain
 * Tailwind/HTML, so a small hand-built primitive fits rather than adding a
 * dependency for two charts. Colors are fixed categorical slots from the
 * data-viz skill's pre-validated reference palette, assigned in a stable
 * order (never cycled).
 *
 * Interaction: hovering a bar dims its siblings and shows a positioned
 * tooltip (category + series swatch + value). Recessive gridlines give
 * scale context; genuinely-zero values draw a flat baseline tick so "zero"
 * reads as data rather than a layout gap; bars grow from the baseline on
 * mount (see .bar-grow in index.css).
 */

export interface BarChartSeries {
  label: string;
  color: string;
  values: number[];
}

interface HoveredBar {
  categoryIndex: number;
  seriesIndex: number;
  /** Tooltip anchor in viewBox coordinates */
  cx: number;
  cy: number;
}

function roundedTopRectPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0 || w <= 0) return '';
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + radius} Q${x},${y} ${x + radius},${y} L${x + w - radius},${y} Q${x + w},${y} ${x + w},${y + radius} L${x + w},${y + h} Z`;
}

/** Rounds up to 1/2/2.5/5 × 10^n so gridline values land on clean numbers. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / base;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * base;
}

export function BarChart({
  categories,
  series,
  formatValue = (v: number) => String(v),
  height = 220,
  showValueLabels = true,
}: {
  categories: string[];
  series: BarChartSeries[];
  formatValue?: (v: number) => string;
  height?: number;
  showValueLabels?: boolean;
}) {
  const [hovered, setHovered] = useState<HoveredBar | null>(null);

  if (categories.length === 0) {
    return <p className="py-6 text-center text-sm text-[var(--muted)]">No data to chart.</p>;
  }

  const width = 640;
  const padding = { top: 20, right: 8, bottom: 28, left: 8 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const baseline = padding.top + plotH;

  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const groupW = plotW / categories.length;
  const barGap = 3;
  const barW = (groupW - barGap * (series.length + 1)) / series.length;

  const gridlines = [1, 2, 3, 4].map((i) => ({
    value: (max * i) / 4,
    y: baseline - (plotH * i) / 4,
  }));

  const hoveredValue = hovered ? (series[hovered.seriesIndex].values[hovered.categoryIndex] ?? 0) : 0;

  return (
    <div className="w-full">
      {series.length > 1 && (
        <div className="mb-2 flex gap-4 text-xs font-medium text-[var(--muted)]">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" onMouseLeave={() => setHovered(null)}>
          {gridlines.map((g) => (
            <g key={g.value}>
              <line x1={padding.left} y1={g.y} x2={padding.left + plotW} y2={g.y} stroke="#f1f5f9" strokeWidth={1} />
              <text x={padding.left + 2} y={g.y - 3} className="fill-slate-400" fontSize={8}>
                {formatValue(g.value)}
              </text>
            </g>
          ))}
          <line x1={padding.left} y1={baseline} x2={padding.left + plotW} y2={baseline} stroke="#e2e8f0" strokeWidth={1} />

          {categories.map((cat, ci) => {
            const groupX = padding.left + ci * groupW;
            return (
              <g key={cat}>
                {series.map((s, si) => {
                  const value = s.values[ci] ?? 0;
                  const h = (value / max) * plotH;
                  const x = groupX + barGap + si * (barW + barGap);
                  const y = baseline - h;
                  const isHovered = hovered?.categoryIndex === ci && hovered?.seriesIndex === si;
                  const dimmed = hovered !== null && !isHovered;
                  return (
                    <g key={s.label}>
                      {value > 0 ? (
                        <path
                          d={roundedTopRectPath(x, y, barW, h, 3)}
                          fill={s.color}
                          className="bar-grow cursor-pointer transition-opacity duration-150"
                          opacity={dimmed ? 0.4 : 1}
                          onMouseEnter={() =>
                            setHovered({ categoryIndex: ci, seriesIndex: si, cx: x + barW / 2, cy: y })
                          }
                        />
                      ) : (
                        // Explicit zero: a flat tick so "no revenue" reads as
                        // data, not as a hole in the layout.
                        <rect
                          x={x}
                          y={baseline - 2}
                          width={barW}
                          height={2}
                          fill={s.color}
                          opacity={dimmed ? 0.25 : 0.5}
                          className="cursor-pointer"
                          onMouseEnter={() =>
                            setHovered({ categoryIndex: ci, seriesIndex: si, cx: x + barW / 2, cy: baseline - 4 })
                          }
                        />
                      )}
                      {showValueLabels && series.length === 1 && value > 0 && (
                        <text
                          x={x + barW / 2}
                          y={y - 5}
                          textAnchor="middle"
                          className="fill-slate-600"
                          fontSize={10}
                          fontWeight={600}
                        >
                          {formatValue(value)}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text x={groupX + groupW / 2} y={height - 10} textAnchor="middle" className="fill-slate-500" fontSize={10}>
                  {cat}
                </text>
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs shadow-md"
            style={{
              left: `${(hovered.cx / width) * 100}%`,
              top: `${(hovered.cy / height) * 100}%`,
              marginTop: -6,
            }}
          >
            <div className="font-medium text-[var(--ink)]">{categories[hovered.categoryIndex]}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[var(--muted)]">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: series[hovered.seriesIndex].color }}
              />
              {series.length > 1 && <span>{series[hovered.seriesIndex].label}:</span>}
              <span className="font-semibold tabular-nums text-[var(--ink)]">{formatValue(hoveredValue)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
