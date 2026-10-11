import type { UtilisationGranularity } from '@/domain/utilisationPeriods';

const GRANULARITIES: { key: UtilisationGranularity; label: string }[] = [
  { key: 'month', label: 'Monthly' },
  { key: 'quarter', label: 'Quarterly' },
  { key: 'year', label: 'Annual' },
];

export function PerformanceFilterBar({
  activePeriodLabel,
  granularity,
  onGranularityChange,
  practitioners,
  selectedPractitionerId,
  onPractitionerChange,
  compareMode,
  onCompareModeChange,
}: {
  activePeriodLabel: string;
  granularity: UtilisationGranularity;
  onGranularityChange: (g: UtilisationGranularity) => void;
  practitioners: { id: string; name: string }[];
  selectedPractitionerId: string | null;
  onPractitionerChange: (id: string | null) => void;
  compareMode: boolean;
  onCompareModeChange: (enabled: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
      {/* Left controls: Date pill + Granularity segmented control */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--ink)] shadow-xs">
          <span className="text-[var(--teal)]" aria-hidden="true">📅</span>
          <span>{activePeriodLabel}</span>
        </div>

        <div className="flex items-center rounded-full border border-[var(--border)] bg-[var(--paper)] p-0.5" role="group" aria-label="Utilisation granularity">
          {GRANULARITIES.map((g) => {
            const active = granularity === g.key;
            return (
              <button
                key={g.key}
                type="button"
                aria-pressed={active}
                onClick={() => onGranularityChange(g.key)}
                className={`min-h-7 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors motion-reduce:transition-none ${
                  active
                    ? 'bg-[var(--surface)] text-[var(--ink)] shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right controls: Practitioner Filter + Compare Toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter by practitioner"
          value={selectedPractitionerId ?? ''}
          onChange={(e) => onPractitionerChange(e.target.value ? e.target.value : null)}
          className="min-h-8 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--ink)] shadow-xs hover:border-[var(--muted)] focus:border-[var(--teal)] focus:outline-none"
        >
          <option value="">All practitioners</option>
          {practitioners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          role="switch"
          aria-checked={compareMode}
          aria-label="Compare previous period"
          onClick={() => onCompareModeChange(!compareMode)}
          className={`flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors motion-reduce:transition-none shadow-xs ${
            compareMode
              ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal-strong)]'
              : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)]'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 rounded-full border transition-all ${
              compareMode
                ? 'border-[var(--teal-strong)] bg-[var(--teal-strong)]'
                : 'border-[var(--muted)] bg-transparent'
            }`}
          />
          <span>Compare</span>
        </button>
      </div>
    </div>
  );
}
