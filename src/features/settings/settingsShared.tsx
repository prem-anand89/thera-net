import { useEffect, useMemo, useState } from 'react';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { PLAN_TIER_LABELS, minimumTierFor, type PlanFeature } from '@/domain/plans';
import { type Clinic } from '@/domain/types';
import { btnPrimary, btnSecondary, ErrorNote } from '@/components/ui';
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
export function useClinicSectionForm<F extends Partial<Clinic>>(
  pick: (clinic: Clinic) => F,
  onDirtyChange: (dirty: boolean) => void
) {
  const clinic = useClinic();
  const initial = useMemo(() => pick(clinic), [clinic]); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState<F>(initial);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hydrate once per mount, not on every `initial` change. `clinic` (from
  // useClinic()) is a new object reference on any write to the clinics row
  // — another admin saving a different section, or this section's own save
  // landing back via the sync pull — and without this guard the effect
  // below would silently overwrite whatever the user is mid-typing here.
  // Not needed for the post-save case: `initial` catching up to match the
  // just-saved `form` already makes `dirty` false via the comparison below,
  // with no need to reassign `form` itself. Each section unmounts on tab
  // switch (SettingsPage's `activeKey === 'x' &&` rendering), so returning
  // to this tab later re-mounts fresh and re-hydrates correctly.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    setForm(initial);
    setLoaded(true);
  }, [initial, loaded]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  // Cleanup clears the flag on unmount too — switching tabs away from a
  // dirty section (after confirming the discard) unmounts it, and without
  // this the rail's dot would keep showing dirty for a section that no
  // longer has any unsaved state to lose.
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  function set(patch: Partial<F>) {
    setSaved(false);
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

  return { clinic, form, set, save, cancel, saveFieldNow, dirty, saved, busy, error, setError };
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

/** Opens a set-once card for editing. Reads and writes stay the same; this
 *  only unlocks the fields until the save goes through. */
export function SetOnceEditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button 
      type="button" 
      aria-label={label} 
      className="flex items-center gap-1.5 min-h-[36px] rounded-lg bg-[var(--paper)] px-3.5 py-1.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--border)] transition-colors border border-[var(--border)] shadow-sm" 
      onClick={onClick}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
      Edit
    </button>
  );
}

/** Two-option pill toggle — same selected/unselected visual language as
 *  Team's invite-role picker (border/background/color keyed off a boolean
 *  instead of a 3-way role), so a feature flag reads the same way a role
 *  or status does elsewhere in Settings, instead of as a plain browser
 *  &lt;select&gt;. */
export function BoolToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
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
            {v ? 'On' : 'Off'}
          </button>
        );
      })}
    </div>
  );
}
