import { useRef, useState } from 'react';
import { useDepartment } from '@/app/DepartmentContext';
import { DEPARTMENT_LABELS, type Department } from '@/domain/departments';
import { segOption, segTrack } from '@/components/ui';

const BAND_COLORS: Record<Department, string> = {
  clinic: 'bg-[var(--teal)]',
  home: 'bg-[var(--sky)]',
  ward: 'bg-[var(--plum)]',
};

/**
 * Universal place switch (OP · Home · IP). Rendered in the Shell header
 * when the user has more than one place to choose from.
 * Wide desktop (desktop:): segmented control.
 * Below desktop: compact trigger button with dropdown menu.
 */
export function DepartmentSwitch() {
  const { department, departments, canSwitch, setDepartment } = useDepartment();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (!canSwitch) return null;

  function toggleMenu() {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const winWidth = typeof window !== 'undefined' ? window.innerWidth : 360;
        const width = Math.min(160, winWidth - 24);
        const left = Math.max(12, Math.min(rect.left, winWidth - width - 12));
        setMenuPos({ top: (rect.bottom || 0) + 8, left, width });
      } else {
        setMenuPos({ top: 48, left: 12, width: 140 });
      }
    }
    setOpen(!open);
  }

  return (
    <div className="flex shrink-0 items-center">
      {/* Wide desktop segmented switch (desktop and up) */}
      <div className="hidden desktop:inline-flex" role="group" aria-label="Place switch">
        <div className={segTrack}>
          {departments.map((dept) => {
            const active = dept === department;
            return (
              <button
                key={dept}
                type="button"
                aria-pressed={active}
                onClick={() => setDepartment(dept)}
                className={segOption(active)}
              >
                {DEPARTMENT_LABELS[dept]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Phone / tablet / zoomed-desktop compact dropdown trigger (below desktop) */}
      <div className="relative desktop:hidden">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Place: ${DEPARTMENT_LABELS[department]}. Switch place`}
          onClick={toggleMenu}
          className="flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--paper)] px-2.5 py-1 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface)]"
        >
          <span>{DEPARTMENT_LABELS[department]}</span>
          <svg aria-hidden className="h-3 w-3 shrink-0 text-[var(--muted)]" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && menuPos && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
            <div
              role="menu"
              aria-label="Switch place"
              style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
              className="fixed z-50 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-lg"
            >
              {departments.map((dept) => {
                const active = dept === department;
                return (
                  <button
                    key={dept}
                    type="button"
                    role="menuitem"
                    aria-pressed={active}
                    onClick={() => {
                      setDepartment(dept);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${active
                        ? 'bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                        : 'text-[var(--ink)] hover:bg-[var(--paper)]'
                      }`}
                  >
                    <span>{DEPARTMENT_LABELS[dept]}</span>
                    {active && <span aria-hidden className="text-xs">✓</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A thin colour band rendered under the header per place:
 * --teal for OP, --sky for Home, --plum for IP.
 * Only shown when the user has more than one place to choose from.
 */
export function DepartmentBand() {
  const { department, canSwitch } = useDepartment();
  if (!canSwitch) return null;
  return <div className={`h-0.5 w-full ${BAND_COLORS[department]}`} role="presentation" />;
}
