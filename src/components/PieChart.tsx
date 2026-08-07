const COLORS = [
  '#2a78d6', // blue
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
  '#e87ba4', // magenta
  '#eb6834', // orange
];

interface PieChartProps {
  data: Array<{ label: string; value: number }>;
  width?: number;
  height?: number;
}

export function PieChart({ data, width = 200, height = 200 }: PieChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) {
    return <div className="py-8 text-center text-sm text-[var(--muted)]">No data</div>;
  }

  const radius = Math.min(width, height) / 2 - 10;
  const centerX = width / 2;
  const centerY = height / 2;

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

    return (
      <path key={i} d={path} fill={COLORS[i % COLORS.length]} className="hover:opacity-80 transition-opacity" />
    );
  });

  return (
    <div className="flex items-center justify-center gap-6">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
        {paths}
      </svg>
      <div className="space-y-2 text-xs">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            <span className="text-[var(--ink)]">
              {d.label} ({d.value})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
