import { useEffect, useMemo, useRef, useState } from 'react';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { PLAN_TIER_LABELS, minimumTierFor, type PlanFeature } from '@/domain/plans';
import { type Clinic } from '@/domain/types';
import { btnPrimary, btnSecondary, ErrorNote, SectionCard } from '@/components/ui';
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
    if (!current) return;
    await repos.clinics.put({ ...current, ...patch, updatedAt: new Date().toISOString() });
    setForm((f) => ({ ...f, ...patch }));
  }

  /** The Save / Cancel bar shows only while there is something to save, a problem to read, or for a moment after saving. */
  const showSaveBar = dirty || justSaved || error !== null;

  return { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError, showSaveBar };
}

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
  return (
    <>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className={btnPrimary}
          disabled={busy || !dirty || saveDisabled}
          onClick={onSave}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={btnSecondary} disabled={!dirty} onClick={onCancel}>
          Cancel
        </button>
        {saved && !dirty && <span className="text-sm text-[var(--moss)]">Saved ✓</span>}
      </div>
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>
    </>
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

/** Two-option pill toggle — same selected/unselected visual language as
 *  Team's invite-role picker (border/background/color keyed off a boolean
 *  instead of a 3-way role), so a feature flag reads the same way a role
 *  or status does elsewhere in Settings, instead of as a plain browser
 *  &lt;select&gt;. */
export function BoolToggle({
  value,
  onChange,
  offLabel = 'Off',
  onLabel = 'On',
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  offLabel?: string;
  onLabel?: string;
}) {
  return (
    <div className="flex gap-1.5">
      {([false, true] as const).map((v) => {
        const selected = value === v;
        return (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            className="flex-1 rounded-lg border px-2 py-1.5 text-center text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
            style={{
              borderColor: selected ? 'var(--teal)' : 'var(--border)',
              background: selected ? 'var(--teal-light)' : 'var(--surface)',
              color: selected ? 'var(--teal)' : 'var(--muted)',
            }}
          >
            {v ? onLabel : offLabel}
          </button>
        );
      })}
    </div>
  );
}
