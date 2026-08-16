import { useState } from 'react';

/**
 * Revenue (bars) and visit-count (line) over the same months, both rebased
 * to "first active month = 100" so they share one honest axis instead of a
 * literal dual-axis chart (independently-scaled axes can make any two
 * series look correlated whether or not they actually are — the #1 chart
 * anti-pattern this deliberately avoids). Bars/line values are the index,
 * not the raw number — hover and the endpoint label always show the real
 * unit (rupees/visits) via formatBarValue/formatLineValue so nothing here
 * is presented as if "100" were a real quantity.
 */

interface HoveredPoint {
  categoryIndex: number;
  series: 'bar' | 'line';
  cx: number;
  cy: number;
}

/** Rebase a series to its first non-zero entry = 100. A series with no
 *  activity at all can't be indexed (no baseline) — flat at 100 rather
 *  than throwing, since the chart still needs to render something. */
function indexSeries(values: number[]): number[] {
  const baseIdx = values.findIndex((v) => v > 0);
  if (baseIdx === -1) return values.map(() => 100);
  const base = values[baseIdx];
  return values.map((v) => Math.round((v / base) * 100));
}

export function IndexedTrendChart({
  categories,
  barValues,
  barLabel,
  formatBarValue = (v: number) => String(v),
  barColor,
  lineValues,
  lineLabel,
  formatLineValue = (v: number) => String(v),
  lineColor,
  height = 240,
}: {
  categories: string[];
  barValues: number[];
  barLabel: string;
  formatBarValue?: (v: number) => string;
  barColor: string;
  lineValues: number[];
  lineLabel: string;
  formatLineValue?: (v: number) => string;
  lineColor: string;
  height?: number;
}) {
  const [hovered, setHovered] = useState<HoveredPoint | null>(null);

  if (categories.length === 0) {
    return <p className="py-6 text-center text-sm text-[var(--muted)]">No data to chart.</p>;
  }

  const barIdx = indexSeries(barValues);
  const lineIdx = indexSeries(lineValues);

  const width = 640;
  const padding = { top: 20, right: 8, bottom: 28, left: 34 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const baseline = padding.top + plotH;

  const allIdx = [...barIdx, ...lineIdx, 100];
  const dataMin = Math.min(...allIdx);
  const dataMax = Math.max(...allIdx);
  const pad = Math.max((dataMax - dataMin) * 0.3, 10);
  const axisMin = Math.floor((dataMin - pad) / 10) * 10;
  const axisMax = Math.ceil((dataMax + pad) / 10) * 10;
  const range = Math.max(1, axisMax - axisMin);

  const yFor = (idx: number) => baseline - ((idx - axisMin) / range) * plotH;
  const groupW = plotW / categories.length;
  const barW = Math.min(28, groupW * 0.5);

  const gridSteps = [0, 1, 2, 3, 4].map((i) => Math.round(axisMin + (range * i) / 4));

  return (
    <div className="w-full">
      <div className="mb-2 flex gap-4 text-xs font-medium text-[var(--muted)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: barColor }} />
          {barLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3" style={{ backgroundColor: lineColor }} />
          {lineLabel}
        </span>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" onMouseLeave={() => setHovered(null)}>
          {gridSteps.map((step) => {
            const y = yFor(step);
            return (
              <g key={step}>
                <line x1={padding.left} y1={y} x2={padding.left + plotW} y2={y} stroke="#f1f5f9" strokeWidth={1} />
                <text x={padding.left - 4} y={y + 3} textAnchor="end" className="fill-slate-400" fontSize={8}>
                  {step === 100 ? '100' : `${step > 100 ? '+' : ''}${step - 100}%`}
                </text>
              </g>
            );
          })}
          {/* Dashed reference line at the shared baseline — "no change since month 1". */}
          <line
            x1={padding.left}
            y1={yFor(100)}
            x2={padding.left + plotW}
            y2={yFor(100)}
            stroke="#cbd5e1"
            strokeWidth={1}
            strokeDasharray="4 3"
          />

          {categories.map((cat, ci) => {
            const groupX = padding.left + ci * groupW;
            const barH = baseline - yFor(barIdx[ci]);
            const barX = groupX + groupW / 2 - barW / 2;
            const barY = yFor(barIdx[ci]);
            const isBarHovered = hovered?.categoryIndex === ci && hovered.series === 'bar';
            return (
              <g key={cat}>
                <rect
                  x={barX}
                  y={barIdx[ci] >= 100 ? barY : baseline}
                  width={barW}
                  height={Math.max(1, Math.abs(barH))}
                  rx={2}
                  fill={barColor}
                  opacity={hovered && !isBarHovered ? 0.5 : 1}
                  className="cursor-pointer transition-opacity"
                  onMouseEnter={() => setHovered({ categoryIndex: ci, series: 'bar', cx: barX + barW / 2, cy: barY })}
                />
                <text x={groupX + groupW / 2} y={height - 10} textAnchor="middle" className="fill-slate-500" fontSize={10}>
                  {cat}
                </text>
              </g>
            );
          })}

          {/* Line overlay, drawn after the bars so it always sits on top. */}
          <polyline
            points={categories.map((_, ci) => `${padding.left + ci * groupW + groupW / 2},${yFor(lineIdx[ci])}`).join(' ')}
            fill="none"
            stroke={lineColor}
            strokeWidth={2}
          />
          {categories.map((_, ci) => {
            const cx = padding.left + ci * groupW + groupW / 2;
            const cy = yFor(lineIdx[ci]);
            const isLineHovered = hovered?.categoryIndex === ci && hovered.series === 'line';
            return (
              <circle
                key={ci}
                cx={cx}
                cy={cy}
                r={isLineHovered ? 4 : 3}
                fill="var(--surface)"
                stroke={lineColor}
                strokeWidth={2}
                className="cursor-pointer"
                onMouseEnter={() => setHovered({ categoryIndex: ci, series: 'line', cx, cy })}
              />
            );
          })}
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: `${(hovered.cx / width) * 100}%`, top: `${(hovered.cy / height) * 100}%`, marginTop: -6 }}
          >
            <div className="font-medium text-[var(--ink)]">{categories[hovered.categoryIndex]}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[var(--muted)]">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: hovered.series === 'bar' ? barColor : lineColor }}
              />
              <span>{hovered.series === 'bar' ? barLabel : lineLabel}:</span>
              <span className="font-semibold tabular-nums text-[var(--ink)]">
                {hovered.series === 'bar'
                  ? formatBarValue(barValues[hovered.categoryIndex])
                  : formatLineValue(lineValues[hovered.categoryIndex])}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
