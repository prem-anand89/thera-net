import { useRef, useState } from 'react';
import { useDepartment } from '@/app/DepartmentContext';
import { DEPARTMENT_LABELS, DEPARTMENT_NAMES, type Department } from '@/domain/departments';
import { Pill, segOption, segTrack } from '@/components/ui';

const PILL_TONES: Record<Department, 'teal' | 'sky' | 'plum'> = {
  clinic: 'teal',
  home: 'sky',
  ward: 'plum',
};

/**
 * Explicit visual badge indicating the active place of service (OP, Home, IP).
 * Shown inside page headers, forms, and modals so staff never miss which place they are working in.
 */
export function DepartmentPill({
  department: explicitDept,
  full = false,
}: {
  department?: Department;
  full?: boolean;
}) {
  const { department: contextDept } = useDepartment();
  const dept = explicitDept ?? contextDept;
  return (
    <Pill tone={PILL_TONES[dept]}>
      {full ? DEPARTMENT_NAMES[dept] : DEPARTMENT_LABELS[dept]}
    </Pill>
  );
}

/**
 * Universal place switch (OP · Home · IP). Rendered in the Shell header
 * when the user has more than one place to choose from.
 * When 2 places are enabled, desktop shows the 1-click segmented toggle and
 * mobile shows a compact dropdown. When 3 places are enabled (OP + Home + IP),
 * it shifts to the dropdown everywhere to conserve header room for navigation.
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
        const width = Math.min(200, winWidth - 24);
        const preferredLeft = rect.right > width + 12 ? rect.right - width : rect.left;
        const left = Math.max(12, Math.min(preferredLeft, winWidth - width - 12));
        setMenuPos({ top: (rect.bottom || 0) + 8, left, width });
      } else {
        setMenuPos({ top: 48, left: 12, width: 180 });
      }
    }
    setOpen(!open);
  }

  const dropdown = (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Place: ${DEPARTMENT_LABELS[department]}. Switch place`}
        onClick={toggleMenu}
        className="flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--paper)] px-2.5 py-1 text-xs font-semibold text-[var(--ink)] hover:border-[var(--teal)]/40 hover:bg-[var(--surface)]"
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
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setOpen(false);
                triggerRef.current?.focus();
              }
            }}
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
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    setDepartment(dept);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${active
                    ? 'bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                    : 'text-[var(--ink)] hover:bg-[var(--paper)]'
                    }`}
                >
                  <span>{DEPARTMENT_NAMES[dept]}</span>
                  {active && <span aria-hidden className="text-xs">✓</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );

  const isTwoPlaces = departments.length === 2;

  return (
    <div className="flex shrink-0 items-center">
      {isTwoPlaces ? (
        <>
          {/* 2 places on wide desktop: segmented toggle */}
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
          {/* 2 places below desktop: compact dropdown */}
          <div className="relative desktop:hidden">{dropdown}</div>
        </>
      ) : (
        /* 3 places on all viewports: compact dropdown */
        <div className="relative">{dropdown}</div>
      )}
    </div>
  );
}
