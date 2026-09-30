import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { db } from '@/lib/db';
import { syncEngine } from '@/sync/engine';
import { AddClinicDialog } from '@/components/AddClinicDialog';
import type { Clinic } from '@/domain/types';

/**
 * The header's clinic pill — where you are, kept visually separate from the
 * Thera.Net mark (the product) on the far left. Shows the clinic's own logo
 * (or its initial) and name. It is the one place to switch clinics (the
 * account menu no longer repeats it) and, for an admin, to add another
 * clinic. A non-admin with a single clinic gets a static label.
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
  const [addingClinic, setAddingClinic] = useState(false);
  const navigate = useNavigate();
  const many = clinics.length > 1;
  const hasMenu = many || isAdmin;
  const sorted = [...clinics].sort((a, b) => a.name.localeCompare(b.name));

  function switchTo(id: string) {
    setOpen(false);
    if (id === clinic.id) return;
    void db.meta.put({ key: 'activeClinicId', value: id });
    void navigate({ to: '/workspace' });
  }

  const identity = (
    <>
      <ClinicAvatar name={clinic.name} logoUrl={logoUrl} />
      <span className="min-w-0 truncate text-sm font-medium text-[var(--ink)] tab:hidden desktop:inline desktop:max-w-[14rem]">
        {clinic.name}
      </span>
      {hasMenu && (
        <svg aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  );
  // The name hides on iPad widths (tab: up to desktop:) — five nav labels
  // leave ~100px there, which only ever showed "Apex…". The clinic's logo
  // (or initial) still identifies it; the tooltip and menu carry the name.
  const pill =
    'flex min-h-10 min-w-0 max-w-full items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--paper)] py-1 pl-1 pr-3 tab:pr-2 desktop:pr-3';

  if (!hasMenu) {
    return (
      <div className={pill} title={clinic.name}>
        {identity}
      </div>
    );
  }

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Clinic: ${clinic.name}. ${many ? 'Switch clinic' : 'Clinic menu'}`}
        title={clinic.name}
        onClick={() => setOpen((current) => !current)}
        className={`${pill} hover:border-[var(--teal)]/40 hover:bg-[var(--surface)]`}
      >
        {identity}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-2 w-[min(16rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg"
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
                onClick={() => switchTo(c.id)}
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

/** The clinic's uploaded logo in a small rounded square, or its initial. */
function ClinicAvatar({ name, logoUrl }: { name: string; logoUrl: string | null | undefined }) {
  if (logoUrl) {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-white">
        <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-xs font-semibold text-white"
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
