import { IconCalendar } from '@/components/NavIcons';

export type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'all' | 'custom';

export const DATE_PRESETS: readonly { key: DatePreset; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
] as const;

export const DAYBOOK_DATE_PRESETS: readonly { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'lastMonth', label: 'Last Month' },
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
    <div role="group" aria-label="Date range" className="hide-scrollbar flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1">
      {presets.map((p) => (
        <button
          key={p.key}
          type="button"
          aria-label={p.key === 'custom' ? p.label : undefined}
          title={p.key === 'custom' ? 'Custom date range' : undefined}
          aria-pressed={value === p.key}
          className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${
            value === p.key
              ? 'bg-[var(--teal)] text-white'
              : 'text-[var(--muted)] hover:bg-[var(--surface)]'
          }`}
          onClick={() => onChange(p.key)}
        >
          {p.key === 'custom' ? (
            <span className="flex items-center justify-center">
              <IconCalendar className="h-4 w-4" />
            </span>
          ) : (
            p.label
          )}
        </button>
      ))}
    </div>
  );
}
