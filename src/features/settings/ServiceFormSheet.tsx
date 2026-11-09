import { useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { repos, catalogService } from '@/services';
import type { CatalogItem } from '@/domain/types';
import { formatAmount, currencySymbol } from '@/domain/money';
import { perSessionLabel, usageLabel } from '@/domain/catalogDisplay';
import { groupNameCheck, nameCheck, nameCheckBlocks } from '@/domain/nameCheck';
import { btnPrimary, btnSecondary, ConfirmDialog, Field, inputCls, RupeeInput, Segmented, SheetDialog } from '@/components/ui';
import { SwitchRow } from './settingsShared';
import { DURATION_ERROR, NameCheckNote, parseDuration, saveErrorMessage } from './catalogShared';

export type ServiceSheetMode = { kind: 'add'; name?: string } | { kind: 'edit'; item: CatalogItem };

type Kind = 'one' | 'package';
const NEW_GROUP = '__new__';
const MIN_PACKAGE = 2;
const MAX_SESSIONS = 100;
const MAX_VALIDITY = 730;
const VALIDITY_CHOICES = [30, 60, 90];

/** "Valid for" box: blank = no expiry (null), a whole number 1–730, anything else undefined. */
function parseValidity(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= MAX_VALIDITY ? n : undefined;
}

/**
 * "Add a service" / "Edit service": one sheet for both. Fields in the order people think (type, name, sessions,
 * price, the per-session line, the reassurance line), then a divider with the optional group and "More" (session
 * length). Save and Cancel stay pinned at the bottom. Names are checked as you type (`nameCheck`) and again by
 * `catalogService` before anything is written.
 */
export function ServiceFormSheet({
  mode,
  allItems,
  groupNames,
  usage,
  onClose,
  onSaved,
}: {
  mode: ServiceSheetMode | null;
  allItems: CatalogItem[];
  groupNames: string[];
  usage: Map<string, number>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  if (!mode) return null;
  // Keyed by the item, so opening another row starts from that row's values.
  return (
    <ServiceForm
      key={mode.kind === 'edit' ? mode.item.id : `add:${mode.name ?? ''}`}
      mode={mode}
      allItems={allItems}
      groupNames={groupNames}
      usage={usage}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function ServiceForm({
  mode,
  allItems,
  groupNames,
  usage,
  onClose,
  onSaved,
}: {
  mode: ServiceSheetMode;
  allItems: CatalogItem[];
  groupNames: string[];
  usage: Map<string, number>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const clinic = useClinic();
  const editing = mode.kind === 'edit' ? mode.item : null;
  const [kind, setKind] = useState<Kind>(editing && editing.sessionCount > 1 ? 'package' : 'one');
  const [name, setName] = useState(editing?.name ?? (mode.kind === 'add' ? mode.name ?? '' : ''));
  const [sessions, setSessions] = useState(editing && editing.sessionCount > 1 ? editing.sessionCount : 5);
  const [pricePaise, setPricePaise] = useState<number | null>(editing?.basePricePaise ?? null);
  const [group, setGroup] = useState((editing?.category ?? '').trim() ?? '');
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [duration, setDuration] = useState(editing?.durationMinutes != null ? String(editing.durationMinutes) : '');
  const [validity, setValidity] = useState(editing?.validityDays != null ? String(editing.validityDays) : '');
  const [active, setActive] = useState(editing?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameId = useId();
  const sessionsId = useId();
  const groupId = useId();
  const priceId = useId();
  const lengthId = useId();
  const validityId = useId();

  const check = nameCheck(name, allItems, { selfId: editing?.id });
  const groupCheck = newGroup !== null ? groupNameCheck(newGroup, groupNames) : null;
  const isPackage = kind === 'package';
  const used = editing ? usage.get(editing.id) ?? 0 : 0;
  // Deleting stays gated on the same count as before (it also counts history the usage figure skips).
  const historyCount = useLiveQuery(
    () => (editing && !editing.active ? repos.visits.countByService(editing.id) : undefined),
    [editing?.id, editing?.active]
  );
  const canDelete = Boolean(editing && !editing.active && historyCount === 0);
  const sessionCount = isPackage ? sessions : 1;
  // Editing: Save stays off until something differs from what is stored (adding is never "unchanged").
  const changed =
    !editing ||
    name.trim() !== editing.name ||
    sessionCount !== editing.sessionCount ||
    pricePaise !== editing.basePricePaise ||
    chosenGroup() !== (editing.category ?? '').trim() ||
    (parseDuration(duration) ?? null) !== (editing.durationMinutes ?? null) ||
    (isPackage ? parseValidity(validity) : null) !== (editing.validityDays ?? null) ||
    active !== editing.active;
  const priceChanged = Boolean(editing && pricePaise != null && pricePaise !== editing.basePricePaise);
  // A used service whose session count changes: only visits logged from now on use the new number.
  const sessionsChanged = Boolean(editing && used > 0 && sessionCount !== editing.sessionCount);

  function chosenGroup(): string {
    if (newGroup === null) return group;
    return groupCheck?.kind === 'exact' && groupCheck.match ? groupCheck.match : newGroup.trim();
  }

  async function save() {
    setError(null);
    if (!name.trim()) return setError('Enter a name.');
    if (nameCheckBlocks(check)) return;
    if (pricePaise == null) return setError(isPackage ? `Enter the price for the whole package (${currencySymbol()}0 if free).` : `Enter a price (${currencySymbol()}0 if free).`);
    if (isPackage && sessions < MIN_PACKAGE) {
      return setError('Packages need 2 or more sessions. For one visit, choose One visit.');
    }
    const durationMinutes = parseDuration(duration);
    if (durationMinutes === undefined) return setError(DURATION_ERROR);
    const validityDays = isPackage ? parseValidity(validity) : null;
    if (validityDays === undefined) return setError(`Enter the days as a whole number from 1 to ${MAX_VALIDITY}, or leave it blank.`);
    const fields = {
      name: name.trim(),
      category: chosenGroup(),
      sessionCount,
      basePricePaise: pricePaise,
      durationMinutes,
      validityDays,
      updatedAt: new Date().toISOString(),
    };
    setSaving(true);
    try {
      const saved = editing
        ? await catalogService.updateService({ ...editing, ...fields, active })
        : await catalogService.addService({ id: crypto.randomUUID(), clinicId: clinic.id, active: true, ...fields });
      onSaved(saved.id);
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  /** "Make it active again": switches the stopped service with this name back on instead of adding a second one. */
  async function offerAgain(match: CatalogItem) {
    setSaving(true);
    setError(null);
    try {
      await repos.catalog.put({ ...match, active: true, updatedAt: new Date().toISOString() });
      onSaved(match.id);
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteForGood() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await catalogService.hardDelete(editing.id);
      setConfirmDelete(false);
      onClose();
    } catch (e) {
      setConfirmDelete(false);
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetDialog
      open
      title={editing ? 'Edit service' : 'Add a service'}
      onClose={onClose}
      busy={saving}
      error={error}
      footer={
        <>
          <button type="button" className={btnSecondary} disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving || nameCheckBlocks(check) || !changed} onClick={() => void save()}>
            {saving ? 'Saving…' : editing ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      {/* Enter in a text or number box saves, like pressing the button (not in the group dropdown or on a button). */}
      <div
        className="space-y-4"
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.defaultPrevented) return;
          const t = e.target as HTMLElement;
          if (t.tagName !== 'INPUT' || (t as HTMLInputElement).type === 'checkbox') return;
          if (saving || nameCheckBlocks(check) || !changed) return;
          e.preventDefault();
          void save();
        }}
      >
        <Segmented
          label="Kind of service"
          options={[
            { value: 'one', label: 'One visit' },
            { value: 'package', label: 'Package' },
          ]}
          value={kind}
          onChange={setKind}
        />

        <Field label="Name" htmlFor={nameId}>
          <input
            id={nameId}
            className={inputCls}
            value={name}
            placeholder={isPackage ? 'e.g. Physiotherapy package' : 'e.g. Follow-up consultation'}
            onChange={(e) => setName(e.target.value)}
            // Opening a row to look at it shouldn't pop up the keyboard; adding starts in the name box.
            autoFocus={!editing}
            autoComplete="off"
          />
          <NameCheckNote
            result={check}
            hiddenText="is inactive"
            restoreLabel={editing ? undefined : 'Make it active again'}
            onRestore={editing ? undefined : (m) => void offerAgain(m)}
            onUse={setName}
          />
        </Field>

        {isPackage && (
          <div>
            <span id={sessionsId} className="mb-1 block text-label font-medium text-[var(--muted)]">
              Number of sessions
            </span>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={sessionsId}>
              <div className="flex items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
                <button
                  type="button"
                  className="h-11 w-11 text-xl font-semibold text-[var(--teal-strong)] disabled:opacity-40"
                  aria-label="One fewer session"
                  disabled={sessions <= MIN_PACKAGE}
                  onClick={() => setSessions((n) => Math.max(MIN_PACKAGE, n - 1))}
                >
                  −
                </button>
                <output aria-live="polite" className="min-w-9 text-center text-base font-semibold tabular-nums">
                  {sessions}
                </output>
                <button
                  type="button"
                  className="h-11 w-11 text-xl font-semibold text-[var(--teal-strong)] disabled:opacity-40"
                  aria-label="One more session"
                  disabled={sessions >= MAX_SESSIONS}
                  onClick={() => setSessions((n) => Math.min(MAX_SESSIONS, n + 1))}
                >
                  +
                </button>
              </div>
              {[5, 10].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={sessions === n}
                  className={`min-h-9 rounded-full border px-3 text-sm ${
                    sessions === n
                      ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal-strong)]'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]'
                  }`}
                  onClick={() => setSessions(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        <Field
          label={isPackage ? 'Price for the whole package' : 'Price'}
          htmlFor={priceId}
          hint={
            <>
              {isPackage && pricePaise != null && (
                <span className="text-[var(--moss)]">{perSessionLabel({ basePricePaise: pricePaise, sessionCount: sessions })}</span>
              )}
              {isPackage && pricePaise != null && priceChanged && ' · '}
              {priceChanged && editing && <span>Was {formatAmount(editing.basePricePaise)}</span>}
            </>
          }
        >
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">{currencySymbol()}</span>
            <RupeeInput id={priceId} valuePaise={pricePaise} onChange={setPricePaise} className={`font-num ${inputCls} !pl-7`} />
          </div>
        </Field>
        {editing && (
          <p className="rounded-lg bg-[var(--paper)] px-3 py-2 text-hint text-[var(--muted)]">
            Applies to visits from now on. Past visits, open packages and issued invoices stay as they were.
          </p>
        )}
        {sessionsChanged && (
          <p role="status" className="rounded-lg bg-[var(--amber-light)] px-3 py-2 text-hint text-[var(--amber-strong)]">
            Visits logged from now on use {sessionCount === 1 ? 'one visit' : `${sessionCount} sessions`}. Packages already
            started keep their own count.
          </p>
        )}

        <div className="-mx-5 border-t border-[var(--border)]" />

        <Field label="Group (optional)" htmlFor={groupId}>
          {newGroup === null ? (
            <select
              id={groupId}
              className={inputCls}
              value={group}
              onChange={(e) => {
                if (e.target.value === NEW_GROUP) setNewGroup('');
                else setGroup(e.target.value);
              }}
            >
              <option value="">No group</option>
              {groupNames.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              <option value={NEW_GROUP}>New group…</option>
            </select>
          ) : (
            <div className="flex gap-2">
              <input
                id={groupId}
                className={inputCls}
                placeholder="New group name"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                autoFocus
              />
              <button type="button" className={btnSecondary} onClick={() => setNewGroup(null)}>
                Cancel
              </button>
            </div>
          )}
          {groupCheck?.kind === 'exact' && (
            <p className="mt-1 text-hint text-[var(--muted)]">This joins the existing group {groupCheck.match}.</p>
          )}
          {groupCheck?.kind === 'similar' && groupCheck.match && (
            <div role="status" className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--amber-light)] px-3 py-2 text-xs text-[var(--amber-strong)]">
              <span>You already have {groupCheck.match}. Use that?</span>
              <button
                type="button"
                className="min-h-8 rounded-md border border-current px-2.5 font-semibold"
                onClick={() => {
                  setGroup(groupCheck.match ?? '');
                  setNewGroup(null);
                }}
              >
                Use {groupCheck.match}
              </button>
            </div>
          )}
        </Field>

        <Field
          label="Session length (minutes, optional)"
          htmlFor={lengthId}
          hint={`${isPackage ? 'Per session. ' : ''}Helps the utilisation report. Leave blank if unsure.`}
        >
          <input
            id={lengthId}
            type="number"
            inputMode="numeric"
            min={1}
            max={480}
            step={1}
            className={inputCls}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>

        {isPackage && (
          <Field
            label="Valid for (days, optional)"
            htmlFor={validityId}
            hint={`Blank means it never expires. Counted from the first visit. Expiry only shows a note; visits can still be logged.${editing ? ' Packages already bought keep what they started with.' : ''}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-24">
                <input
                  id={validityId}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_VALIDITY}
                  step={1}
                  className={inputCls}
                  value={validity}
                  onChange={(e) => setValidity(e.target.value)}
                />
              </div>
              {VALIDITY_CHOICES.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={validity === String(d)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    validity === String(d)
                      ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal-strong)]'
                      : 'border-[var(--border)] text-[var(--muted)]'
                  }`}
                  onClick={() => setValidity(String(d))}
                >
                  {d} days
                </button>
              ))}
            </div>
          </Field>
        )}

        {editing && (
          <div className="space-y-2 border-t border-[var(--border)] pt-3">
            <SwitchRow
              label="Active"
              hint="Turn off to stop using it on new visits. Past visits keep it."
              checked={active}
              onChange={setActive}
            />
            <p className="text-hint text-[var(--muted)]">
              {used > 0
                ? `${usageLabel(used)}, so it can't be deleted.`
                : editing.active
                  ? 'Not used yet. To delete it, make it inactive first.'
                  : 'Not used yet.'}
            </p>
            {canDelete && (
              <button type="button" className="min-h-9 text-sm font-medium text-[var(--rust)] underline" onClick={() => setConfirmDelete(true)}>
                Delete this service
              </button>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this service?"
        message={`Permanently delete "${editing?.name ?? ''}"? This cannot be undone.`}
        confirmLabel={saving ? 'Deleting…' : 'Delete'}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void deleteForGood()}
      />
    </SheetDialog>
  );
}
