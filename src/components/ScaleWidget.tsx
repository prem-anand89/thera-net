/**
 * §14.16: the shared 0–10 segmented scale behind NRS (Pain Profile) and
 * PSFS (Functional Status, both baseline and current) — same widget, same
 * CSS (`.nrs-scale`/`.psfs-scale` style identically), different outer class
 * per the mockup and different endpoint labels per instrument.
 */
export function ScaleWidget({
  variant,
  value,
  onChange,
  endpoints,
  disabled,
}: {
  variant: 'nrs' | 'psfs';
  value: number | null;
  onChange: (next: number) => void;
  endpoints: [string, string];
  disabled?: boolean;
}) {
  if (value === null) {
    return (
      <div style={{ padding: '12px 10px', color: 'var(--muted)', fontSize: 12.5, fontStyle: 'italic' }}>
        Not assessed
      </div>
    );
  }

  return (
    <div>
      <div className={`${variant}-scale`}>
        {Array.from({ length: 11 }, (_, n) => (
          <div
            key={n}
            className={`n${value === n ? ' active' : ''}`}
            onClick={disabled ? undefined : () => onChange(n)}
          >
            {n}
          </div>
        ))}
      </div>
      <div className="scale-labels">
        <span>{endpoints[0]}</span>
        <span>{endpoints[1]}</span>
      </div>
    </div>
  );
}
