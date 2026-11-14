import { useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { setActiveClinic } from '@/app/useActiveClinic';
import { syncEngine } from '@/sync/engine';
import { AddClinicDialog } from '@/components/AddClinicDialog';
import { initialsFor } from './accountInitials';
import type { Clinic } from '@/domain/types';

/** First word of the clinic name so the desktop/iPad-landscape header keeps room for modules. */
function clinicFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * The header's clinic pill — sits before the Place switcher (`DepartmentSwitch`)
 * so clinic identity never collides with the user's own profile avatar on the right.
 * Desktop & iPad landscape (`desktop:`): logo/initials + first name (+ caret if multiple clinics).
 * iPad portrait & mobile (`< desktop:`): logo/initials only (+ caret if multiple clinics).
 * Static badge when only one clinic is available (`Add another clinic` stays in AccountMenu).
 */
export function ClinicSwitcher({
  clinic,
  clinics,
  logoUrl,
  isAdmin,
}: {
  clinic: Clinic;
  clinics: Clinic[];
  logoUrl: string | null | undefined;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [addingClinic, setAddingClinic] = useState(false);
  const navigate = useNavigate();
  const many = clinics.length > 1;
  const hasMenu = many;
  const sorted = [...clinics].sort((a, b) => a.name.localeCompare(b.name));

  function toggleMenu() {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const width = Math.min(256, window.innerWidth - 24);
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
        setMenuPos({ top: rect.bottom + 8, left, width });
      }
    }
    setOpen(!open);
  }

  async function switchTo(id: string) {
    setOpen(false);
    if (id === clinic.id) return;
    await setActiveClinic(id);
    void navigate({ to: '/workspace' });
  }

  const shortName = clinicFirstName(clinic.name);
  const identity = (
    <>
      <ClinicAvatar name={clinic.name} logoUrl={logoUrl} />
      <span className="hidden min-w-0 max-w-[8rem] truncate text-xs font-semibold text-[var(--ink)] desktop:inline">
        {shortName}
      </span>
      {hasMenu && (
        <svg aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  );
  // Compact logo/initials pill on phone & iPad portrait (< desktop);
  // logo/initials + clinic first word on desktop & iPad landscape (`desktop:`).
  const pill = hasMenu
    ? 'flex min-h-8 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--paper)] px-1.5 py-0.5 desktop:gap-2 desktop:px-2 desktop:py-1 transition-colors'
    : 'flex min-h-8 min-w-0 max-w-full shrink-0 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 sm:shrink desktop:px-2 desktop:py-1';

  if (!hasMenu) {
    return (
      <div className={pill} title={clinic.name}>
        {identity}
      </div>
    );
  }

  return (
    // Phone: never squeezed below logo + caret (a squeezed pill spilled over its neighbours); from sm: the name may truncate.
    <div className="relative shrink-0 sm:min-w-0 sm:shrink">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Clinic: ${clinic.name}. ${many ? 'Switch clinic' : 'Clinic menu'}`}
        title={clinic.name}
        onClick={toggleMenu}
        className={`${pill} hover:border-[var(--teal)]/40`}
      >
        {identity}
      </button>
      {open && menuPos && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
            className="fixed z-20 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg"
          >
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              {many ? 'Switch clinic' : 'Clinic'}
            </p>
            {sorted.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitemradio"
                aria-checked={c.id === clinic.id}
                onClick={() => void switchTo(c.id)}
                className={`flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                  c.id === clinic.id ? 'bg-[var(--teal-light)] font-medium text-[var(--teal-strong)]' : 'text-[var(--ink)] hover:bg-[var(--paper)]'
                }`}
              >
                <span className="w-4 shrink-0" aria-hidden>
                  {c.id === clinic.id ? '✓' : ''}
                </span>
                <span className="truncate">{c.name}</span>
              </button>
            ))}
            {isAdmin && (
              <button
                type="button"
                role="menuitem"
                className="flex min-h-10 w-full items-center gap-2 border-t border-[var(--border)] px-3 py-2 text-left text-sm text-[var(--ink)] hover:bg-[var(--paper)]"
                onClick={() => {
                  setOpen(false);
                  setAddingClinic(true);
                }}
              >
                <span className="w-4 shrink-0 text-center text-[var(--teal)]" aria-hidden>
                  +
                </span>
                Add another clinic
              </button>
            )}
          </div>
        </>
      )}
      {addingClinic && (
        <AddClinicDialog
          onClose={() => setAddingClinic(false)}
          onCreated={() => {
            setAddingClinic(false);
            void syncEngine.schedule(0);
            void navigate({ to: '/workspace' });
          }}
        />
      )}
    </div>
  );
}

/** The clinic's uploaded logo in a small rounded square, or its 2-letter initials. */
export function ClinicAvatar({
  name,
  logoUrl,
  size = 'md',
}: {
  name: string;
  logoUrl: string | null | undefined;
  size?: 'sm' | 'md';
}) {
  const dims = size === 'sm' ? 'h-5 w-5 rounded-md text-[10px]' : 'h-7 w-7 rounded-md text-xs';
  if (logoUrl) {
    return (
      <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--paper)] ${dims}`}>
        <img src={logoUrl} alt="" className="h-full w-full object-contain" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-md bg-[var(--ink)] font-semibold text-white ${dims}`}
    >
      {initialsFor(name)}
    </span>
  );
}
