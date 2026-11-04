import { useId, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { catalogService, dashboardService, repos } from '@/services';
import type { TreatmentItem } from '@/domain/types';
import { btnPrimary, btnSecondary, Field, inputCls, SectionCard, SheetDialog } from '@/components/ui';
import { nameCheck, nameCheckBlocks } from '@/domain/nameCheck';
import { SwitchRow } from './settingsShared';
import { HiddenItemsFooter, MiniSwitch, NameCheckNote, saveErrorMessage } from './catalogShared';
import { useShowUsage } from './useShowUsage';

/** Counts are visits in the last 90 days: the same window the visit screen uses to put the most used first. */
const USAGE_DAYS = 90;

type TreatmentSheet = { kind: 'add' } | { kind: 'edit'; item: TreatmentItem };

/**
 * Treatments: what you did in the session. One wrap of chips, most used first (the order the visit screen offers
 * them). "+ Add" in the header and tapping a chip open the same small sheet; hidden treatments sit in a footer. Counts
 * only with "Show usage" (a per-device view switch).
 */
export function TreatmentCatalog() {
  const clinic = useClinic();
  const items = useLiveQuery(() => repos.treatmentCatalog.list(clinic.id, true), [clinic.id]);
  const usageRows = useLiveQuery(() => dashboardService.treatmentUsageCounts(clinic.id, USAGE_DAYS), [clinic.id]);
  const [showUsage, setShowUsage] = useShowUsage('treatments');
  const [sheet, setSheet] = useState<TreatmentSheet | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);

  const all = useMemo(() => items ?? [], [items]);
  const counts = useMemo(() => new Map((usageRows ?? []).map((r) => [r.treatmentId, r.count])), [usageRows]);
  const shown = useMemo(
    () =>
      all
        .filter((i) => i.active)
        .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name)),
    [all, counts]
  );
  const hidden = useMemo(() => all.filter((i) => !i.active).sort((a, b) => a.name.localeCompare(b.name)), [all]);

  return (
    <div className="max-w-[640px]">
      <SectionCard
        id="settings-card-services-treatments"
        title="Treatments"
        action={
          <button type="button" className={`${btnPrimary} min-h-9 px-3 text-sm`} onClick={() => setSheet({ kind: 'add' })}>
            + Add
          </button>
        }
      >
        <p className="mb-2 text-xs text-[var(--muted)]">
          What you did in the session, for your clinical record. Not on the bill. Shown as quick picks on each visit, most
          used first.
        </p>
        <div className="mb-3 flex justify-end">
          <MiniSwitch label="Show usage" checked={showUsage} onChange={setShowUsage} />
        </div>

        {shown.length === 0 ? (
          <p className="py-4 text-sm text-[var(--muted)]">
            {hidden.length > 0
              ? 'No active treatments. Turn one back on under Inactive, or add one with "+ Add".'
              : 'No treatments yet. Add the first one with "+ Add".'}
          </p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-2">
              {shown.map((item) => (
                <li key={item.id}>
                  <Chip item={item} count={showUsage ? counts.get(item.id) ?? 0 : undefined} onOpen={() => setSheet({ kind: 'edit', item })} />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Tap a treatment to rename or hide it.{showUsage ? ` Counts are visits in the last ${USAGE_DAYS} days.` : ''}
            </p>
          </>
        )}

        <HiddenItemsFooter label="Inactive" count={hidden.length} open={hiddenOpen} onToggle={() => setHiddenOpen((v) => !v)}>
          <ul className="flex flex-wrap gap-2 p-3">
            {hidden.map((item) => (
              <li key={item.id}>
                <Chip item={item} dim onOpen={() => setSheet({ kind: 'edit', item })} />
              </li>
            ))}
          </ul>
        </HiddenItemsFooter>
      </SectionCard>

      {sheet && <TreatmentForm key={sheet.kind === 'edit' ? sheet.item.id : 'add'} mode={sheet} all={all} onClose={() => setSheet(null)} />}
    </div>
  );
}

function Chip({ item, count, dim = false, onOpen }: { item: TreatmentItem; count?: number; dim?: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Edit ${item.name}`}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 text-sm text-[var(--ink)] hover:bg-[var(--paper)] active:border-[var(--teal)] active:bg-[var(--paper)] ${
        dim ? 'opacity-60' : ''
      }`}
      onClick={onOpen}
    >
      {item.name}
      {count !== undefined && <span className="text-xs tabular-nums text-[var(--muted)]">{count}</span>}
    </button>
  );
}

/** "Add a treatment" / "Edit treatment": a name (checked as you type) and, when editing, whether it is shown. */
function TreatmentForm({ mode, all, onClose }: { mode: TreatmentSheet; all: TreatmentItem[]; onClose: () => void }) {
  const clinic = useClinic();
  const editing = mode.kind === 'edit' ? mode.item : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [active, setActive] = useState(editing?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const check = nameCheck(name, all, { selfId: editing?.id });

  async function save() {
    setError(null);
    if (!name.trim()) return setError('Enter a name.');
    if (nameCheckBlocks(check)) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (editing) await catalogService.updateTreatment({ ...editing, name: name.trim(), active, updatedAt: now });
      else await catalogService.addTreatment({ id: crypto.randomUUID(), clinicId: clinic.id, name: name.trim(), active: true, updatedAt: now });
      onClose();
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  /** "Make it active again": switches the hidden treatment with this name back on instead of adding a second one. */
  async function showAgain(match: TreatmentItem) {
    setSaving(true);
    setError(null);
    try {
      await repos.treatmentCatalog.put({ ...match, active: true, updatedAt: new Date().toISOString() });
      onClose();
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetDialog
      open
      title={editing ? 'Edit treatment' : 'Add a treatment'}
      onClose={onClose}
      busy={saving}
      error={error}
      footer={
        <>
          <button type="button" className={btnSecondary} disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving || nameCheckBlocks(check)} onClick={() => void save()}>
            {saving ? 'Saving…' : editing ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <Field label="Name" htmlFor={nameId}>
        <input
          id={nameId}
          className={inputCls}
          value={name}
          placeholder="e.g. Manual therapy"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
          // A one-field sheet: the name is what you came to change, so it takes focus (the dialog does this itself).
          autoFocus
          autoComplete="off"
        />
        <NameCheckNote
          result={check}
          hiddenText="is inactive"
          restoreLabel={editing ? undefined : 'Make it active again'}
          onRestore={editing ? undefined : (m) => void showAgain(m)}
          onUse={setName}
        />
      </Field>
      {editing && (
        <div className="mt-4 border-t border-[var(--border)] pt-2">
          <SwitchRow
            label="Active"
            hint="Turn off to stop using it on new visits. Past visits keep it."
            checked={active}
            onChange={setActive}
          />
        </div>
      )}
    </SheetDialog>
  );
}
