import { formatINR } from '@/domain/money';
import type { BucketReport } from '@/domain/utilisationReport';

export function RevenueVolumeCard({
  reports,
  activeIndex,
  onSelectBucket,
  compareMode = false,
}: {
  reports: BucketReport[];
  activeIndex: number;
  onSelectBucket: (index: number) => void;
  compareMode?: boolean;
}) {
  const activeReport = reports[activeIndex] ?? reports[reports.length - 1];
  const activeRevenue = activeReport?.clinicRevenuePaise ?? 0;
  const priorRevenue = activeReport?.priorClinicRevenuePaise ?? null;

  const deltaPaise = priorRevenue != null ? activeRevenue - priorRevenue : null;

  // Max value calculation for bar heights
  const maxRevenue = Math.max(
    1,
    ...reports.map((r) => Math.max(r.clinicRevenuePaise, r.priorClinicRevenuePaise ?? 0))
  );

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xs">
      <div>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold text-[var(--ink)]">Revenue</h3>
            <p className="text-xs text-[var(--muted)]">Total clinic appointment billing</p>
          </div>
          <span className="rounded-full bg-[var(--paper)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">
            {activeReport?.bucket.label ?? '—'}
          </span>
        </div>

        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-num text-3xl font-bold tracking-tight text-[var(--ink)]">
            {formatINR(activeRevenue)}
          </span>
          {compareMode && deltaPaise != null && (
            <span
              className={`font-num text-xs font-semibold ${
                deltaPaise >= 0 ? 'text-[var(--teal)]' : 'text-[var(--rust)]'
              }`}
            >
              {deltaPaise >= 0 ? `+${formatINR(deltaPaise)}` : `-${formatINR(Math.abs(deltaPaise))}`}{' '}
              vs prior
            </span>
          )}
        </div>
      </div>

      {/* Bar Chart Area */}
      <div className="mt-4 flex h-28 items-end gap-2 px-1">
        {reports.map((r, i) => {
          const isSelected = i === activeIndex;
          const heightPct = Math.max(8, Math.round((r.clinicRevenuePaise / maxRevenue) * 100));
          const priorHeightPct =
            r.priorClinicRevenuePaise != null
              ? Math.max(8, Math.round((r.priorClinicRevenuePaise / maxRevenue) * 100))
              : 0;

          return (
            <button
              key={r.bucket.key}
              type="button"
              aria-label={`${r.bucket.label}: ${formatINR(r.clinicRevenuePaise)}`}
              onClick={() => onSelectBucket(i)}
              className="group relative flex flex-1 flex-col items-center justify-end h-full focus:outline-hidden"
            >
              {/* Tooltip on hover */}
              <div className="pointer-events-none absolute -top-7 hidden rounded-md bg-[var(--ink)] px-1.5 py-0.5 text-[10px] text-white shadow-xs group-hover:block whitespace-nowrap z-10">
                {r.bucket.label}: {formatINR(r.clinicRevenuePaise)}
              </div>

              <div className="flex w-full items-end justify-center gap-1">
                {/* Prior period comparison bar */}
                {compareMode && r.priorClinicRevenuePaise != null && (
                  <div
                    style={{ height: `${priorHeightPct}%` }}
                    className="w-2.5 rounded-t-sm border border-dashed border-[var(--muted)] bg-[var(--paper)] opacity-70 transition-all group-hover:opacity-100"
                    title={`Prior: ${formatINR(r.priorClinicRevenuePaise)}`}
                  />
                )}

                {/* Main active bar */}
                <div
                  style={{ height: `${heightPct}%` }}
                  className={`w-4 rounded-t-sm transition-all ${
                    isSelected
                      ? 'bg-[var(--teal)] shadow-xs ring-2 ring-[var(--teal-light)]'
                      : 'bg-[var(--teal)] opacity-50 group-hover:opacity-85'
                  }`}
                />
              </div>

              {/* Bucket short label underneath bar */}
              <span
                className={`mt-1.5 block text-[10px] font-medium transition-colors ${
                  isSelected ? 'font-semibold text-[var(--ink)]' : 'text-[var(--muted)]'
                }`}
              >
                {r.bucket.label.slice(0, 3)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Legend Footer */}
      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2 text-[10px] text-[var(--muted)]">
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
        <span>Billed revenue</span>
      </div>
    </div>
  );
}
