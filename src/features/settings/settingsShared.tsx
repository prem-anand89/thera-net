import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { PLAN_TIER_LABELS, minimumTierFor, type PlanFeature } from '@/domain/plans';
import { type Clinic } from '@/domain/types';
import { btnPrimary, btnSecondary, SectionCard } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';

/** Accent hues used by the Danger zone, team cards and other in-section badges. */
export type Accent = 'teal' | 'amber' | 'rust' | 'moss' | 'slate';

export const ACCENT_VARS: Record<Accent, { color: string; light: string }> = {
  teal: { color: 'var(--teal)', light: 'var(--teal-light)' },
  amber: { color: 'var(--amber)', light: 'var(--amber-light)' },
  rust: { color: 'var(--rust)', light: 'var(--rust-light)' },
  moss: { color: 'var(--moss)', light: 'var(--moss-light)' },
  slate: { color: 'var(--slate)', light: 'var(--slate-light)' },
};

/**
 * Shared save mechanics for a section that edits a slice of the Clinic row.
 * Re-fetches the current row at save time and merges just this section's
 * fields into it, rather than writing back a form snapshot that could be
 * stale for fields another section owns — the Clinic row has no partial-
 * patch API, so a naive "write the whole form" save would silently revert
 * whatever another section saved in between.
 */
/** How long "Saved ✓" stays after a save before the bar hides. */
export const SAVED_NOTE_MS = 2000;

/** Field-by-field equality for a card's form (the same JSON comparison the dirty check has always used). */
function sameFields(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useClinicSectionForm<F extends Partial<Clinic>>(
  pick: (clinic: Clinic) => F,
  onDirtyChange: (dirty: boolean) => void
) {
  const clinic = useClinic();
  const initial = useMemo(() => pick(clinic), [clinic]); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState<F>(initial);
  const [saved, setSaved] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every field is editable straight away (no Edit button), so a card has to tell apart "the person changed this"
  // from "the saved values changed underneath" (a sync pull, another admin, another card's save landing back via
  // `useClinic()`, which hands out a new object on any write to the clinic row). The rule: when the saved values
  // change, a card with no unsaved edits takes the new values; a card with edits keeps them. Without this an
  // untouched card would show Save on its own after a sync, and pressing it would write the older values back.
  const lastInitial = useRef(initial);
  useEffect(() => {
    const previous = lastInitial.current;
    lastInitial.current = initial;
    if (sameFields(previous, initial)) return;
    setForm((current) => (sameFields(current, previous) ? initial : current));
  }, [initial]);

  const dirty = useMemo(() => !sameFields(form, initial), [form, initial]);
  // Cleanup clears the flag on unmount too — switching tabs away from a
  // dirty section (after confirming the discard) unmounts it, and without
  // this the rail's dot would keep showing dirty for a section that no
  // longer has any unsaved state to lose.
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  // "Saved ✓" stays on screen briefly after a save, then the bar goes away with nothing left to save.
  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), SAVED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [justSaved]);

  function set(patch: Partial<F>) {
    setSaved(false);
    setJustSaved(false);
    setForm((f) => ({ ...f, ...patch }));
  }

  async function save(): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      const current = await repos.clinics.get(clinic.id);
      if (!current) throw new Error('Clinic not found');
      await repos.clinics.put({ ...current, ...form, updatedAt: new Date().toISOString() });
      setSaved(true);
      setJustSaved(true);
      return true;
    } catch (e) {
      setError(toFriendlyMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setForm(initial);
    setError(null);
  }

  /** Writes one field immediately (e.g. after a logo upload finishes) and
   *  folds it into local state so the dirty check doesn't flag it as an
   *  unsaved edit — it's already persisted. */
  async function saveFieldNow(patch: Partial<F>) {
    const current = await repos.clinics.get(clinic.id);
    if (!current) throw new Error('Clinic not found');
    await repos.clinics.put({ ...current, ...patch, updatedAt: new Date().toISOString() });
    setForm((f) => ({ ...f, ...patch }));
  }

  /** The Save / Cancel bar shows only while there is something to save, a problem to read, or for a moment after saving. */
  const showSaveBar = dirty || justSaved || error !== null;

  return { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError, showSaveBar };
}

/**
 * The Save / Cancel row at the end of a Settings card. It is part of the card (static, never floating): it appears only
 * while there is something to save, a problem to read, or for a moment after saving (see `showSaveBar` in
 * {@link useClinicSectionForm}). A floating bar read as "something is broken" and took height phones and iPads don't
 * have, so it sits at the card's foot like any form. The status ("Unsaved changes", "Saving…", "Saved ✓") shares the
 * buttons' row, and a problem is one line above them. The Settings tab's dot already shows unsaved work elsewhere on
 * the page, and leaving with unsaved edits asks first.
 */
export function SectionSaveBar({
  dirty,
  saved,
  busy,
  onSave,
  onCancel,
  error,
  saveDisabled,
}: {
  dirty: boolean;
  saved: boolean;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  error: string | null;
  saveDisabled?: boolean;
}) {
  const status = busy ? 'Saving…' : dirty ? 'Unsaved changes' : saved ? 'Saved ✓' : '';
  return (
    <div data-testid="section-save-bar" className="mt-4 border-t border-[var(--border)] pt-3">
      {error && (
        <p role="alert" className="mb-2 text-xs leading-snug text-[var(--rust)]">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <span
          role="status"
          className={`min-w-0 flex-1 truncate text-sm ${dirty && !busy ? 'text-[var(--amber)]' : saved && !dirty ? 'text-[var(--moss)]' : 'text-[var(--muted)]'}`}
        >
          {status}
        </span>
        <button type="button" className={btnSecondary} disabled={!dirty || busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} disabled={busy || !dirty || saveDisabled} onClick={onSave}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/**
 * Placeholder shown instead of a section's real content once it's above the
 * clinic's plan tier. Informational only, no CTA — there's no self-serve
 * upgrade flow yet (tier changes are still a manual update, see
 * FEATURES_AND_SCHEMA.md's clinic_plans section); a real "Upgrade" button
 * would go nowhere. Revisit once one exists.
 */
export function LockedSectionNotice({
  feature,
  sectionLabel,
}: {
  feature: PlanFeature;
  sectionLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper)] p-8 text-center">
      <p className="text-sm font-medium text-[var(--ink)]">
        {sectionLabel} isn’t included in your plan.
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Included in {PLAN_TIER_LABELS[minimumTierFor(feature)]} and above.
      </p>
    </div>
  );
}

/**
 * The compact stand-in for a card whose feature is above the clinic's plan: the card itself, with its title and one
 * line saying which plan has it. Keeps the card in the page (so Settings search still lands on it) without a large
 * empty box. Partner & split uses the same wording for its disabled state.
 */
export function LockedCard({ id, title, feature }: { id: string; title: string; feature: PlanFeature }) {
  return (
    <SectionCard id={id} title={title}>
      <p className="text-sm text-[var(--muted)]">Available on the {PLAN_TIER_LABELS[minimumTierFor(feature)]} plan and above.</p>
    </SectionCard>
  );
}

/**
 * The one on/off control in Settings: the label and what it does on the left, a real switch (`role="switch"`) on the
 * right, in a 44px row. When the two states mean something specific, say so in the hint.
 */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex min-h-11 items-center justify-between gap-3 ${disabled ? 'opacity-70' : 'cursor-pointer'}`}>
      <span>
        <span className="block text-sm font-medium text-[var(--ink)]">{label}</span>
        {hint && <span className="block text-xs text-[var(--muted)]">{hint}</span>}
      </span>
      {/* The input stays the real control (role="switch", keyboard, screen readers); the track and thumb are its picture. */}
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-11 shrink-0 rounded-full bg-[var(--border)] transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform after:content-[''] peer-checked:bg-[var(--teal)] peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--teal)] peer-focus-visible:ring-offset-2"
      />
    </label>
  );
}
