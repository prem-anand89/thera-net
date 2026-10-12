import { useState } from 'react';
import type { BucketReport } from '@/domain/utilisationReport';

function formatHours(minutes: number): string {
  const hrs = Math.round((minutes / 60) * 10) / 10;
  return Number.isInteger(hrs) ? `${hrs} hrs` : `${hrs.toFixed(1)} hrs`;
}

export function CapacityHoursCard({
  reports,
  activeIndex,
  onSelectBucket,
  compareMode = false,
  title = 'Capacity & Work Hours',
  subtitle = 'Work hours vs available capacity',
}: {
  reports: BucketReport[];
  activeIndex: number;
  onSelectBucket: (index: number) => void;
  compareMode?: boolean;
  title?: string;
  subtitle?: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const activeIdx = hoveredIndex ?? activeIndex;
  const activeReport = reports[activeIdx] ?? reports[reports.length - 1];

  const workedMinutes = activeReport?.clinicWorkedMinutes ?? 0;
  const availableMinutes = activeReport?.clinicAvailableMinutes ?? 0;
  const idleMinutes = Math.max(0, availableMinutes - workedMinutes);

  const priorWorkedMinutes = activeReport?.priorClinicWorkedMinutes ?? null;
  const deltaMinutes =
    priorWorkedMinutes != null ? workedMinutes - priorWorkedMinutes : null;

  // Max value calculation for bar heights (at least available minutes or max worked)
  const maxMinutes = Math.max(
    1,
    ...reports.map((r) =>
      Math.max(
        r.clinicWorkedMinutes,
        r.priorClinicWorkedMinutes ?? 0,
        Math.min(r.clinicAvailableMinutes, r.clinicWorkedMinutes)
      )
    )
  );

  // SVG Geometry
  const width = 360;
  const height = 170;
  const paddingX = 16;
  const paddingTop = 16;
  const baseline = 135;
  const plotH = baseline - paddingTop;
  const plotW = width - paddingX * 2;
  const groupW = reports.length > 0 ? plotW / reports.length : plotW;
  const barW = Math.max(8, Math.min(18, groupW - 6));

  return (
    <div className="chart-panel flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xs">
      <div>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold text-[var(--ink)]">{title}</h3>
            <p className="text-xs text-[var(--muted)]">{subtitle}</p>
          </div>
          <span className="whitespace-nowrap rounded-full bg-[var(--paper)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">
            {activeReport?.bucket.label ?? '—'}
          </span>
        </div>

        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-num text-3xl font-bold tracking-tight text-[var(--ink)]">
            {formatHours(workedMinutes)}
          </span>
          {compareMode && deltaMinutes != null && (
            <span
              className={`font-num text-xs font-semibold ${
                deltaMinutes >= 0 ? 'text-[var(--teal)]' : 'text-[var(--rust)]'
              }`}
            >
              {deltaMinutes >= 0 ? `+${formatHours(deltaMinutes)}` : `-${formatHours(Math.abs(deltaMinutes))}`}{' '}
              vs prior
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          of {formatHours(availableMinutes)} total capacity · {formatHours(idleMinutes)} open
        </p>
      </div>

      {/* SVG Bar Chart Area */}
      <div className="relative mt-3">
        {/* Floating tooltip above hovered bar */}
        {hoveredIndex != null && (
          <div
            className="pointer-events-none absolute -top-3 z-20 -translate-x-1/2 rounded-md bg-[var(--ink)] px-2 py-0.5 text-[11px] font-semibold text-[var(--paper)] shadow-md transition-all whitespace-nowrap"
            style={{
              left: `${((paddingX + hoveredIndex * groupW + groupW / 2) / width) * 100}%`,
            }}
          >
            {activeReport?.bucket.label}: {formatHours(workedMinutes)}
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
            y1={baseline}
            x2={width - paddingX}
            y2={baseline}
            stroke="var(--border)"
            strokeWidth="1"
          />

          {reports.map((r, i) => {
            const isSelected = i === activeIdx;
            const centerX = paddingX + i * groupW + groupW / 2;
            const barX = centerX - barW / 2;
            const val = r.clinicWorkedMinutes;
            const h = val > 0 ? Math.max(6, Math.round((val / maxMinutes) * plotH)) : 0;
            const y = baseline - h;

            // Prior period bar
            const priorVal = r.priorClinicWorkedMinutes ?? 0;
            const priorH =
              compareMode && priorVal > 0 ? Math.max(6, Math.round((priorVal / maxMinutes) * plotH)) : 0;
            const priorY = baseline - priorH;

            return (
              <g key={r.bucket.key}>
                {/* Column highlight for selected bucket */}
                {isSelected && (
                  <rect
                    x={centerX - groupW / 2 + 2}
                    y={paddingTop - 4}
                    width={groupW - 4}
                    height={plotH + 8}
                    rx="4"
                    fill="var(--teal)"
                    opacity="0.08"
                  />
                )}

                {/* Compare mode prior bar */}
                {compareMode && priorH > 0 && (
                  <rect
                    x={barX - 2}
                    y={priorY}
                    width={barW}
                    height={priorH}
                    rx="2"
                    fill="var(--paper)"
                    stroke="var(--muted)"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    opacity="0.75"
                  />
                )}

                {/* Main worked hours bar */}
                {val > 0 ? (
                  <rect
                    x={barX}
                    y={y}
                    width={barW}
                    height={h}
                    rx="3"
                    fill="var(--teal)"
                    opacity={isSelected ? 1 : 0.6}
                    className="transition-all hover:opacity-90"
                  />
                ) : (
                  /* 2px baseline tick for zero hours */
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

                {/* Active selection indicator on top of bar */}
                {isSelected && val > 0 && (
                  <circle
                    cx={centerX}
                    cy={Math.max(8, y - 5)}
                    r="2.5"
                    fill="var(--teal)"
                  />
                )}
              </g>
            );
          })}
        </svg>

        {/* Month labels underneath (Native HTML layer) */}
        <div className="pointer-events-none absolute bottom-0 inset-x-0 flex items-center justify-between px-3.5">
          {reports.map((r, i) => {
            const isSelected = i === activeIdx;
            return (
              <span
                key={`lbl-${r.bucket.key}`}
                className={`text-[10px] transition-colors ${
                  isSelected ? 'font-bold text-[var(--ink)]' : 'font-medium text-[var(--muted)]'
                }`}
              >
                {r.bucket.label.slice(0, 3)}
              </span>
            );
          })}
        </div>

        {/* HTML Accessible Click Overlay */}
        <div className="pointer-events-auto absolute inset-0 flex items-stretch">
          {reports.map((r, i) => (
            <button
              key={r.bucket.key}
              type="button"
              aria-label={`${r.bucket.label}: ${formatHours(r.clinicWorkedMinutes)}`}
              onClick={() => onSelectBucket(i)}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              className="flex-1 cursor-pointer focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
              title={`${r.bucket.label}: ${formatHours(r.clinicWorkedMinutes)} worked of ${formatHours(r.clinicAvailableMinutes)}`}
            />
          ))}
        </div>
      </div>

      {/* Legend Footer */}
      <div className="mt-2 flex items-center justify-between border-t border-[var(--border)] pt-2 text-[10px] text-[var(--muted)]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-xs bg-[var(--teal)]" />
            <span>{activeReport?.bucket.label ?? 'Current'}</span>
          </span>
          {compareMode && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-xs border border-dashed border-[var(--muted)] bg-[var(--paper)]" />
              <span>Prior period</span>
            </span>
          )}
        </div>
        <span>Clinical work hours</span>
      </div>
    </div>
  );
}
