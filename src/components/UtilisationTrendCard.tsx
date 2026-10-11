import type { BucketReport } from '@/domain/utilisationReport';

const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 100)}%`);

export function UtilisationTrendCard({
  reports,
  activeIndex,
  onSelectBucket,
  compareMode = false,
  targetRatio = 0.7,
  title = 'Utilisation',
  subtitle = 'Percentage of available time utilised',
}: {
  reports: BucketReport[];
  activeIndex: number;
  onSelectBucket: (index: number) => void;
  compareMode?: boolean;
  targetRatio?: number;
  title?: string;
  subtitle?: string;
}) {
  const activeReport = reports[activeIndex] ?? reports[reports.length - 1];
  const activeRatio = activeReport?.clinicRatio ?? null;
  const priorRatio = activeReport?.priorClinicRatio ?? null;

  const deltaPts =
    activeRatio != null && priorRatio != null
      ? Math.round((activeRatio - priorRatio) * 100)
      : null;

  // SVG Chart Geometry
  const width = 360;
  const height = 120;
  const paddingX = 16;
  const paddingTop = 14;
  const baseline = 96;
  const plotH = baseline - paddingTop;
  const plotW = width - paddingX * 2;

  const points = reports.map((r, i) => {
    const x = paddingX + (reports.length > 1 ? (i / (reports.length - 1)) * plotW : plotW / 2);
    const ratio = Math.max(0, Math.min(1, r.clinicRatio ?? 0));
    const y = baseline - ratio * plotH;
    return { x, y, r, index: i };
  });

  const comparePoints = reports.map((r, i) => {
    const x = paddingX + (reports.length > 1 ? (i / (reports.length - 1)) * plotW : plotW / 2);
    const ratio = Math.max(0, Math.min(1, r.priorClinicRatio ?? 0));
    const y = baseline - ratio * plotH;
    return { x, y };
  });

  const pathD = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, '');
  const areaD = points.length > 0
    ? `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${baseline} L ${points[0].x.toFixed(1)} ${baseline} Z`
    : '';
  const comparePathD = comparePoints.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, '');

  const targetY = baseline - targetRatio * plotH;

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xs">
      <div>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold text-[var(--ink)]">{title}</h3>
            <p className="text-xs text-[var(--muted)]">{subtitle}</p>
          </div>
          <span className="rounded-full bg-[var(--paper)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">
            {activeReport?.bucket.label ?? '—'}
          </span>
        </div>

        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-num text-3xl font-bold tracking-tight text-[var(--ink)]">
            {pct(activeRatio)}
          </span>
          {compareMode && deltaPts != null && (
            <span
              className={`font-num text-xs font-semibold ${
                deltaPts >= 0 ? 'text-[var(--teal)]' : 'text-[var(--rust)]'
              }`}
            >
              {deltaPts >= 0 ? `+${deltaPts}` : deltaPts} pts vs prior
            </span>
          )}
        </div>
      </div>

      {/* SVG Trend Line Chart */}
      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-28 w-full overflow-visible"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="util-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--teal)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--teal)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Baseline rule */}
          <line
            x1={paddingX}
            y1={baseline}
            x2={width - paddingX}
            y2={baseline}
            stroke="var(--border)"
            strokeWidth="1"
          />

          {/* Target line */}
          <line
            x1={paddingX}
            y1={targetY}
            x2={width - paddingX}
            y2={targetY}
            stroke="var(--muted)"
            strokeDasharray="4 3"
            strokeOpacity="0.6"
            strokeWidth="1.2"
          />

          {/* Target label */}
          <text
            x={width - paddingX}
            y={Math.max(10, targetY - 4)}
            textAnchor="end"
            className="fill-[var(--muted)] text-[9px] font-semibold"
          >
            Target {Math.round(targetRatio * 100)}%
          </text>

          {/* Area fill under curve */}
          {areaD && (
            <path
              d={areaD}
              fill="url(#util-area-grad)"
            />
          )}

          {/* Compare curve */}
          {compareMode && comparePathD && (
            <path
              d={comparePathD}
              fill="none"
              stroke="var(--muted)"
              strokeDasharray="3 3"
              strokeWidth="1.5"
              strokeOpacity="0.5"
            />
          )}

          {/* Active curve */}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke="var(--teal)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Month labels underneath */}
          {points.map((p) => {
            const isSelected = p.index === activeIndex;
            return (
              <text
                key={`lbl-${p.r.bucket.key}`}
                x={p.x}
                y={baseline + 16}
                textAnchor="middle"
                className={`text-[10px] transition-colors ${
                  isSelected ? 'fill-[var(--ink)] font-bold' : 'fill-[var(--muted)] font-medium'
                }`}
              >
                {p.r.bucket.label.slice(0, 3)}
              </text>
            );
          })}
        </svg>

        {/* Interactive Point Buttons */}
        <div className="pointer-events-auto absolute inset-0">
          {points.map((p) => {
            const isSelected = p.index === activeIndex;
            return (
              <button
                key={p.r.bucket.key}
                type="button"
                aria-label={`${p.r.bucket.label}: ${pct(p.r.clinicRatio)}`}
                onClick={() => onSelectBucket(p.index)}
                title={`${p.r.bucket.label}: ${pct(p.r.clinicRatio)}`}
                className="group absolute -translate-x-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center focus:outline-hidden cursor-pointer"
                style={{
                  left: `${(p.x / width) * 100}%`,
                  top: `${(p.y / height) * 100}%`,
                }}
              >
                <span
                  className={`block rounded-full transition-all ${
                    isSelected
                      ? 'h-3.5 w-3.5 bg-[var(--teal)] ring-3 ring-[var(--surface)] shadow-md'
                      : 'h-2 w-2 bg-[var(--teal)] opacity-60 group-hover:scale-150 group-hover:opacity-100'
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend Footer */}
      <div className="mt-2 flex items-center justify-between border-t border-[var(--border)] pt-2 text-[10px] text-[var(--muted)]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--teal)]" />
            <span>{activeReport?.bucket.label ?? 'Current'}</span>
          </span>
          {compareMode && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full border border-[var(--muted)] bg-transparent" />
              <span>Prior period</span>
            </span>
          )}
        </div>
        <span>Target {Math.round(targetRatio * 100)}%</span>
      </div>
    </div>
  );
}
