// "Pain and effort after each session": a small line chart of the highest pain and effort reported each day (from
// `trendSeries`), pain in rust and effort in sky, with a legend and a sentence for screen readers.
import { trendChart, type TrendPoint } from './homeProgram';

const W = 300;
const H = 70;
const PAD = 6;
const pts = (line: TrendPoint[]) => line.map((p) => `${p.x},${p.y}`).join(' ');

export function ProgramTrend({ series }: { series: Array<{ date: string; pain: number | null; effort: number | null }> }) {
  const chart = trendChart(series, { width: W, height: H, pad: PAD });
  const ends = [
    { key: 'effort', p: chart?.effort.at(-1), cls: 'bg-[var(--sky)]' },
    { key: 'pain', p: chart?.pain.at(-1), cls: 'bg-[var(--rust)]' },
  ].filter((d): d is { key: string; p: TrendPoint; cls: string } => d.p != null);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Pain and effort after each session</p>
      {!chart ? (
        <p className="text-sm text-[var(--muted)]">No session feedback yet.</p>
      ) : (
        <>
          <div className="relative h-[70px] w-full">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={chart.label} className="absolute inset-0 h-full w-full overflow-visible">
              <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="var(--border)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              <polyline fill="none" stroke="var(--rust)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" points={pts(chart.pain)} />
              <polyline fill="none" stroke="var(--sky)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" points={pts(chart.effort)} />
            </svg>
            {/* Each line's last point as an HTML dot, so it stays round while the chart stretches (and a single report still shows). */}
            {ends.map((d) => <span key={d.key} data-point={d.key} aria-hidden="true" className={`absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${d.cls}`} style={{ left: `${(d.p.x / W) * 100}%`, top: `${(d.p.y / H) * 100}%` }} />)}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--rust)]" />Pain (0–10)</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--sky)]" />Effort (0–10)</span>
          </div>
        </>
      )}
    </div>
  );
}
