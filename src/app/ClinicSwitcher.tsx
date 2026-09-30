import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { db } from '@/lib/db';
import type { Clinic } from '@/domain/types';

/**
 * Header identity: logo + clinic name on every screen size. With two or more
 * clinics it doubles as the switcher (same switch as the account menu:
 * remember the active clinic, go back to Workspace).
 */
export function ClinicSwitcher({
  clinic,
  clinics,
  logoUrl,
}: {
  clinic: Clinic;
  clinics: Clinic[];
  logoUrl: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const many = clinics.length > 1;
  const sorted = [...clinics].sort((a, b) => a.name.localeCompare(b.name));

  function switchTo(id: string) {
    setOpen(false);
    if (id === clinic.id) return;
    void db.meta.put({ key: 'activeClinicId', value: id });
    void navigate({ to: '/workspace' });
  }

  const identity = (
    <>
      <img
        src={logoUrl || '/apple-touch-icon.png'}
        alt=""
        className={logoUrl ? 'h-8 w-auto max-w-16 shrink-0 object-contain' : 'h-8 w-8 shrink-0 rounded-[8px] object-contain'}
      />
      <span className="min-w-0 text-left">
        <span className="block max-w-[9rem] truncate font-display text-base font-semibold leading-tight text-[var(--ink)] sm:max-w-[12rem] desktop:max-w-[14rem]">
          {clinic.name}
        </span>
        <span className="hidden text-[11px] leading-tight text-[var(--muted)] tab:block">Thera.Net</span>
      </span>
      {many && (
        <span aria-hidden className="text-xs text-[var(--muted)]">
          ▾
        </span>
      )}
    </>
  );

  if (!many) return <div className="flex min-w-0 items-center gap-2">{identity}</div>;

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Clinic: ${clinic.name}. Switch clinic`}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-1 hover:bg-[var(--paper)]"
      >
        {identity}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className="absolute left-0 top-full z-20 mt-2 w-64 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Switch clinic</p>
            {sorted.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitemradio"
                aria-checked={c.id === clinic.id}
                onClick={() => switchTo(c.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                  c.id === clinic.id ? 'bg-[var(--teal-light)] font-medium text-[var(--teal-strong)]' : 'text-[var(--ink)] hover:bg-[var(--paper)]'
                }`}
              >
                <span className="w-4 shrink-0" aria-hidden>
                  {c.id === clinic.id ? '✓' : ''}
                </span>
                <span className="truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
