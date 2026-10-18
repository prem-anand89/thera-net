import { useState } from 'react';
import type { UUID } from '@/domain/types';

type FilterTherapist = { id: UUID; name: string; color: string };

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
}: {
  therapists: FilterTherapist[];
  visibleIds: UUID[];
  onToggle: (id: UUID) => void;
  onShowAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = visibleIds.length === 0 ? therapists : therapists.filter((t) => visibleIds.includes(t.id));
  const label =
    visibleIds.length === 0
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
        <span className="hidden truncate sm:inline">{label}</span>
        <span className="sr-only sm:hidden">{label}</span>
        <svg aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
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
