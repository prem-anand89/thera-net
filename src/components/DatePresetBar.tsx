export type DatePreset = 'week' | 'month' | 'lastMonth' | 'all' | 'custom';

export const DATE_PRESETS: readonly { key: DatePreset; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
] as const;

export interface DatePresetBarProps {
  value: DatePreset;
  onChange: (preset: DatePreset) => void;
  presets?: readonly { key: DatePreset; label: string }[];
}

export function DatePresetBar({
  value,
  onChange,
  presets = DATE_PRESETS,
}: DatePresetBarProps) {
  return (
    <div className="hide-scrollbar flex w-full gap-1 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1 sm:w-auto">
      {presets.map((p) => (
        <button
          key={p.key}
          type="button"
          className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${
            value === p.key
              ? 'bg-[var(--teal)] text-white'
              : 'text-[var(--muted)] hover:bg-[var(--surface)]'
          }`}
          onClick={() => onChange(p.key)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
