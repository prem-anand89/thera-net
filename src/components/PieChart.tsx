import { SERIES_COLORS } from '@/components/chartColors';

interface PieChartProps {
  data: Array<{ label: string; value: number }>;
  width?: number;
  height?: number;
  /** Legend shows each slice's share of the total instead of its raw value. */
  showPercent?: boolean;
  /** Controlled selection — clicking a slice or legend row calls onSelect with
   *  its index, or null if the already-selected one was clicked again. Omit
   *  both props to keep the chart non-interactive (existing callers). */
  selectedIndex?: number | null;
  onSelect?: (index: number | null) => void;
}

export function PieChart({ data, width = 200, height = 200, showPercent = false, selectedIndex = null, onSelect }: PieChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) {
    return <div className="py-8 text-center text-sm text-[var(--muted)]">No data</div>;
  }

  const radius = Math.min(width, height) / 2 - 10;
  const centerX = width / 2;
  const centerY = height / 2;
  const interactive = onSelect != null;

  function toggle(i: number) {
    onSelect?.(selectedIndex === i ? null : i);
  }

  let currentAngle = -90; // Start at top

  const paths = data.map((d, i) => {
    const sliceAngle = (d.value / total) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = centerX + radius * Math.cos(startRad);
    const y1 = centerY + radius * Math.sin(startRad);
    const x2 = centerX + radius * Math.cos(endRad);
    const y2 = centerY + radius * Math.sin(endRad);

    const largeArc = sliceAngle > 180 ? 1 : 0;

    const path = [
      `M ${centerX} ${centerY}`,
      `L ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      'Z',
    ].join(' ');

    currentAngle = endAngle;
    const dimmed = interactive && selectedIndex != null && selectedIndex !== i;

    return (
      <path
        key={i}
        d={path}
        fill={SERIES_COLORS[i % SERIES_COLORS.length]}
        opacity={dimmed ? 0.35 : 1}
        onClick={interactive ? () => toggle(i) : undefined}
        className={`transition-opacity ${interactive ? 'cursor-pointer' : 'hover:opacity-80'}`}
      />
    );
  });

  return (
    <div className="flex items-center justify-center gap-6">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
        {paths}
      </svg>
      <div className="space-y-1 text-xs">
        {data.map((d, i) => {
          const valueLabel = showPercent ? `${Math.round((d.value / total) * 100)}%` : d.value;
          const Row = interactive ? 'button' : 'div';
          return (
            <Row
              key={i}
              type={interactive ? 'button' : undefined}
              onClick={interactive ? () => toggle(i) : undefined}
              className={`flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left ${
                interactive ? 'cursor-pointer hover:bg-[var(--paper)]' : ''
              } ${selectedIndex === i ? 'bg-[var(--teal-light)]' : ''}`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
              />
              <span className="text-[var(--ink)]">
                {d.label} ({valueLabel})
              </span>
            </Row>
          );
        })}
      </div>
    </div>
  );
}
