import { useState } from 'react';
import type { UUID } from '@/domain/types';
import { Panel } from '@/components/ui';

type FilterTherapist = { id: UUID; name: string; color: string; /** Shown under the name in the phone sheet, e.g. "2 booked". */ summary?: string };

/**
 * Below `desktop:` (no rail), which therapists' columns show — one compact
 * button instead of a row of name chips. Same filter state as the rail's
 * checkboxes (`visibleIds` empty = everyone).
 */
export function TherapistFilter({
  therapists,
  visibleIds,
  onToggle,
  onShowAll,
  showLabel = false,
  sheet = false,
  onOnly,
  single,
}: {
  therapists: FilterTherapist[];
  visibleIds: UUID[];
  onToggle: (id: UUID) => void;
  onShowAll: () => void;
  /** Show the selection's name at every width (phone chip: "Dr Asha", "2 of 3 therapists", "All therapists"). */
  showLabel?: boolean;
  /** Phones: open the list as a bottom sheet (a popover can run off a narrow screen) with an "Only" shortcut per row. */
  sheet?: boolean;
  onOnly?: (id: UUID) => void;
  /** Phone 3-Day shows one therapist: the sheet becomes a single choice (radio rows, no "Show all" / "Only"). */
  single?: { selectedId: UUID | null; onSelect: (id: UUID) => void };
}) {
  const [open, setOpen] = useState(false);
  const shown = single
    ? therapists.filter((t) => t.id === single.selectedId)
    : visibleIds.length === 0 ? therapists : therapists.filter((t) => visibleIds.includes(t.id));
  const label = single
    ? shown[0]?.name ?? 'Pick a therapist'
    : visibleIds.length === 0
      ? 'All therapists'
      : shown.length === 1
        ? shown[0].name
        : `${shown.length} of ${therapists.length} therapists`;

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-9 max-w-[12rem] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
      >
        <span className="flex -space-x-1" aria-hidden>
          {shown.slice(0, 3).map((t) => (
            <span key={t.id} className="h-2.5 w-2.5 rounded-full ring-2 ring-[var(--surface)]" style={{ background: t.color }} />
          ))}
        </span>
        <span className={`min-w-0 truncate ${showLabel ? 'inline' : 'hidden sm:inline'}`}>{label}</span>
        {!showLabel && <span className="sr-only sm:hidden">{label}</span>}
        <svg aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {sheet && single && (
        <Panel open={open} onClose={() => setOpen(false)} title="Show one therapist">
          <ul className="-mx-4 divide-y divide-[var(--border)] border-y border-[var(--border)]" role="radiogroup" aria-label="Therapist">
            {therapists.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={single.selectedId === t.id}
                  className="flex min-h-[3.25rem] w-full items-center gap-3 px-4 text-left"
                  onClick={() => {
                    single.onSelect(t.id);
                    setOpen(false);
                  }}
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${single.selectedId === t.id ? 'border-[var(--teal)]' : 'border-[var(--border)]'}`}
                  >
                    {single.selectedId === t.id && <span className="h-2.5 w-2.5 rounded-full bg-[var(--teal)]" />}
                  </span>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-[var(--ink)]">{t.name}</span>
                    {t.summary && <span className="block truncate text-xs text-[var(--muted)]">{t.summary}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {sheet && !single && (
        <Panel open={open} onClose={() => setOpen(false)} title="Show therapists">
          {visibleIds.length > 0 && (
            <button type="button" className="mb-1 min-h-11 text-sm font-medium text-[var(--teal)]" onClick={onShowAll}>
              Show all
            </button>
          )}
          <ul className="-mx-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {therapists.map((t) => (
              <li key={t.id} className="flex min-h-[3.25rem] items-center gap-3 px-4">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 rounded"
                    style={{ accentColor: t.color }}
                    checked={visibleIds.length === 0 || visibleIds.includes(t.id)}
                    onChange={() => onToggle(t.id)}
                  />
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-[var(--ink)]">{t.name}</span>
                    {t.summary && <span className="block truncate text-xs text-[var(--muted)]">{t.summary}</span>}
                  </span>
                </label>
                {onOnly && (
                  <button
                    type="button"
                    className="min-h-11 shrink-0 px-2 text-sm font-medium text-[var(--teal)]"
                    aria-label={`Only ${t.name}`}
                    onClick={() => {
                      onOnly(t.id);
                      setOpen(false);
                    }}
                  >
                    Only
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-3 min-h-11 w-full rounded-xl bg-[var(--teal)] text-sm font-semibold text-white"
            onClick={() => setOpen(false)}
          >
            Done
          </button>
        </Panel>
      )}
      {open && !sheet && !single && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-full z-30 mt-1.5 w-[min(16rem,calc(100vw-1.5rem))] rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-xs font-semibold text-[var(--muted)]">Show therapists</span>
              {visibleIds.length > 0 && (
                <button type="button" className="text-xs font-medium text-[var(--teal)]" onClick={onShowAll}>
                  Show all
                </button>
              )}
            </div>
            {therapists.map((t) => (
              <label key={t.id} className="flex min-h-10 cursor-pointer items-center gap-2.5 px-3 text-sm text-[var(--ink)] hover:bg-[var(--paper)]">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded"
                  style={{ accentColor: t.color }}
                  checked={visibleIds.length === 0 || visibleIds.includes(t.id)}
                  onChange={() => onToggle(t.id)}
                />
                <span className="truncate">{t.name}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
