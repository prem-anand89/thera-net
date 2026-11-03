import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { repos, catalogService } from '@/services';
import { formatINR } from '@/domain/money';
import {
  effectivePricePerSession,
  type CatalogItem,
  type ReferringSourceItem,
  type TreatmentItem,
} from '@/domain/types';
import { Field, inputCls, btnPrimary, btnSecondary, ErrorNote, RupeeInput, SectionCard, ConfirmDialog, Segmented } from '@/components/ui';
import { REFERRALS_CARD_ID } from './sections';
import { groupNameCheck, nameCheck, nameCheckBlocks, NameTakenError, type NameCheckResult, type NamedItem } from '@/domain/nameCheck';

/** Every service in the clinic (offered and not), for the name check in the add and edit forms. */
const AllServicesContext = createContext<CatalogItem[]>([]);

/** A name refused by `catalogService` reads as itself; anything else gets the usual friendly message. */
function saveErrorMessage(e: unknown): string {
  return e instanceof NameTakenError ? e.message : toFriendlyMessage(e);
}

/**
 * The live name check under a name box: the same name (capitals ignored) blocks and says so; a hidden one offers to
 * switch it back on; a near match only asks. Renders nothing when the name is free.
 */
function NameCheckNote<T extends NamedItem>({
  result,
  hiddenText,
  restoreLabel,
  onRestore,
  onUse,
}: {
  result: NameCheckResult<T>;
  /** e.g. "is in No longer offered" / "is hidden". */
  hiddenText: string;
  restoreLabel?: string;
  onRestore?: (match: T) => void;
  onUse: (name: string) => void;
}) {
  const match = result.match;
  if (!match || result.kind === 'none') return null;
  const name = match.name.trim();
  const block = nameCheckBlocks(result);
  const action =
    result.kind === 'hidden' && onRestore && restoreLabel
      ? { label: restoreLabel, run: () => onRestore(match) }
      : result.kind === 'similar'
        ? { label: `Use ${name}`, run: () => onUse(name) }
        : null;
  const text =
    result.kind === 'exact'
      ? `You already have ${name}.`
      : result.kind === 'hidden'
        ? `${name} ${hiddenText}.`
        : `You already have ${name}. Use that?`;
  return (
    <div
      role={block ? 'alert' : 'status'}
      className={`mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-xs ${
        block ? 'bg-[var(--rust-light)] text-[var(--rust)]' : 'bg-[var(--amber-light)] text-[var(--amber-strong)]'
      }`}
    >
      <span>{text}</span>
      {action && (
        <button type="button" className="min-h-8 rounded-md border border-current px-2.5 font-semibold" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}
import { toFriendlyMessage } from '@/lib/errors';

/** The two lists on the Services & treatments tab. Referral sources live on General ("How patients found you"). */
export type CatalogView = 'packages' | 'treatments';

const CATALOG_VIEWS: { value: CatalogView; label: string }[] = [
  { value: 'packages', label: 'Services' },
  { value: 'treatments', label: 'Treatments' },
];

export function CatalogSection({ view, onViewChange }: { view: CatalogView; onViewChange: (v: CatalogView) => void }) {
  return (
    <div>
      <div className="mb-5">
        <Segmented label="Services or treatments" options={CATALOG_VIEWS} value={view} onChange={onViewChange} />
      </div>
      {view === 'packages' ? <ServiceCatalog /> : <TreatmentCatalog />}
    </div>
  );
}

/** Only ever rendered for the exception (inactive) — an active item is
 *  already the default, unflagged state, so badging it on every row added
 *  no information and just cluttered the common case. */
function InactivePill() {
  return (
    <span
      className="inline-block self-start rounded-full px-2.5 py-0.5 text-caption font-semibold"
      style={{ background: 'var(--paper)', color: 'var(--muted)' }}
    >
      Hidden
    </span>
  );
}

/** A visible bordered button, not a bare "text + hover:underline" link —
 *  the underline-on-hover alone gave no affordance on touch devices,
 *  which have no hover state, so Edit/Deactivate/Rename read as plain
 *  text until tapped. */
function CatalogActionButton({
  tone = 'teal',
  children,
  onClick,
}: {
  tone?: 'teal' | 'rust';
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        tone === 'rust'
          ? 'min-h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-hint font-semibold text-[var(--rust)] hover:bg-[var(--rust-light)]'
          : 'min-h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-hint font-semibold text-[var(--teal)] hover:bg-[var(--teal-light)]'
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CatalogCardShell({
  active,
  children,
  footer,
}: {
  active: boolean;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      className={`flex h-full flex-col gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm ${active ? '' : 'opacity-60'}`}
    >
      {children}
      <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--border)] pt-2.5">
        {footer}
      </div>
    </div>
  );
}

function CatalogAddCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--paper)] p-4">
      <h4 className="text-sm font-semibold text-[var(--ink)]">{title}</h4>
      {hint && <p className="mt-1 mb-3 text-xs text-[var(--muted)]">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </div>
  );
}

const DURATION_HINT = 'Per session for a package. Used for time reports; leave blank to count the whole session.';
const DURATION_ERROR = 'Enter minutes between 1 and 480, or leave it blank.';

/** Blank -> null (valid); a whole number 1-480 -> that number; anything else
 *  -> undefined (invalid). The database check rejects values outside 1-480,
 *  so the form must never send one. */
function parseDuration(raw: string): number | null | undefined {
  const t = raw.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 && n <= 480 ? n : undefined;
}

function groupKey(category: string) {
  return category.trim() || 'Uncategorized';
}

function ServiceCatalog() {
  const clinic = useClinic();
  const items = useLiveQuery(() => repos.catalog.list(clinic.id, true), [clinic.id]);
  const [search, setSearch] = useState('');
  const searching = search.trim().length > 0;

  // Active and inactive items are shown in two separate places — active
  // ones grouped by category as before, inactive ones in their own
  // cleanup-focused section below (where Delete, gated on zero usage,
  // lives) — rather than interspersed dimmed rows inside their old group.
  const activeGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const map = new Map<string, CatalogItem[]>();
    for (const item of items ?? []) {
      if (!item.active) continue;
      if (query && !item.name.toLowerCase().includes(query)) continue;
      const key = groupKey(item.category);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items, search]);

  const inactiveItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (items ?? [])
      .filter((i) => !i.active)
      .filter((i) => !query || i.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, search]);

  const groupNames = useMemo(
    () => [...new Set((items ?? []).map((i) => groupKey(i.category)))].sort(),
    [items]
  );

  return (
    <AllServicesContext.Provider value={items ?? []}>
    <SectionCard id="settings-card-services-packages" title="Services and prices">
      <p className="mb-1 text-xs text-[var(--muted)]">
        What patients pay for. You pick these on a visit, and they print on bills and invoices.
      </p>
      <p className="mb-3 text-xs text-[var(--muted)]">
        Charge for the visit or the package. Record what you did in the session under Treatments.
      </p>
      <input
        type="search"
        className={`${inputCls} mb-4`}
        placeholder="Search services…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <datalist id="catalog-service-groups">
        {groupNames.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {activeGroups.length > 0 ? (
        <div className="mb-6 space-y-4">
          {activeGroups.map(([category, catItems]) => (
            <ServiceGroupPanel
              key={category}
              category={category}
              items={catItems}
              forceOpen={searching}
              groupNames={groupNames}
            />
          ))}
        </div>
      ) : (
        <p className="mb-6 text-xs text-[var(--muted)]">
          {searching ? `No active services match "${search.trim()}".` : 'No services yet — add a group below.'}
        </p>
      )}

      {inactiveItems.length > 0 && (
        <InactiveServicesSection items={inactiveItems} groupNames={groupNames} forceOpen={searching} />
      )}

      <NewServiceGroupForm existingGroupNames={groupNames} />
    </SectionCard>
    </AllServicesContext.Provider>
  );
}

function InactiveServicesSection({
  items,
  groupNames,
  forceOpen,
}: {
  items: CatalogItem[];
  groupNames: string[];
  forceOpen: boolean;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const open = forceOpen || !collapsed;

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-dashed border-[var(--border)] bg-[var(--paper)]">
      <div className="flex items-center gap-1.5 px-3 py-2.5">
        <button
          type="button"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--surface)]"
          aria-expanded={open}
          aria-label={open ? 'Collapse no longer offered' : 'Expand no longer offered'}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span style={{ transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>›</span>
        </button>
        <h3 className="text-sm font-semibold text-[var(--ink)]">No longer offered</h3>
        <span className="text-hint text-[var(--muted)]">({items.length})</span>
      </div>
      {open && (
        <div className="divide-y divide-[var(--border)] bg-[var(--surface)]">
          {items.map((item) => (
            <ServiceCatalogItemRow key={item.id} item={item} groupNames={groupNames} showCategory />
          ))}
        </div>
      )}
    </div>
  );
}

type CatalogAddKind = 'single' | 'package';

function SessionKindPill({ sessionCount }: { sessionCount: number }) {
  const isPackage = sessionCount > 1;
  return (
    <span
      className="inline-block shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold"
      style={
        isPackage
          ? { background: 'var(--teal-light)', color: 'var(--teal-strong)' }
          : { background: 'var(--paper)', color: 'var(--muted)', border: '1px solid var(--border)' }
      }
    >
      {isPackage ? `Package · ${sessionCount} sessions` : 'One visit'}
    </span>
  );
}

function ServiceGroupPanel({
  category,
  items,
  forceOpen = false,
  groupNames,
}: {
  category: string;
  items: CatalogItem[];
  /** While searching, every matching group stays expanded regardless
   *  of its own remembered collapsed state, so a result is never hidden
   *  behind a collapsed panel. */
  forceOpen?: boolean;
  /** Every existing group name clinic-wide, for the per-item "move to a
   *  different group" dropdown. */
  groupNames: string[];
}) {
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState(category);
  const [groupRenameBusy, setGroupRenameBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [addKind, setAddKind] = useState<CatalogAddKind | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const open = forceOpen || !collapsed;

  useEffect(() => {
    if (!editingGroupName) setGroupNameDraft(category);
  }, [category, editingGroupName]);

  useEffect(() => {
    setAddKind(null);
  }, [category]);

  const renameCheck = editingGroupName ? groupNameCheck(groupNameDraft, groupNames, category) : null;

  async function saveGroupRename() {
    // Typing an existing group's name (capitals ignored) moves these services into that group, under its spelling.
    const trimmed = renameCheck?.kind === 'exact' && renameCheck.match ? renameCheck.match : groupNameDraft.trim();
    if (!trimmed) {
      setGroupError('Group name is required');
      return;
    }
    if (trimmed === category) {
      setEditingGroupName(false);
      setGroupError(null);
      return;
    }
    setGroupRenameBusy(true);
    setGroupError(null);
    try {
      const now = new Date().toISOString();
      for (const item of items) {
        await repos.catalog.put({ ...item, category: trimmed, updatedAt: now });
      }
      setEditingGroupName(false);
      setAddKind(null);
    } catch (e) {
      setGroupError(saveErrorMessage(e));
    } finally {
      setGroupRenameBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="flex flex-col gap-2 border-b border-[var(--border)] bg-[var(--paper)] px-3 py-2.5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <button
            type="button"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--surface)]"
            aria-expanded={open}
            aria-label={open ? `Collapse ${category}` : `Expand ${category}`}
            onClick={() => setCollapsed((c) => !c)}
          >
            <span style={{ transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>›</span>
          </button>
          <div className="min-w-0 flex-1">
            {editingGroupName ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={`${inputCls} max-w-xs text-sm font-semibold`}
                  value={groupNameDraft}
                  onChange={(e) => setGroupNameDraft(e.target.value)}
                  aria-label="Group name"
                  autoFocus
                />
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={groupRenameBusy}
                  onClick={() => void saveGroupRename()}
                >
                  {groupRenameBusy ? 'Saving…' : 'Save name'}
                </button>
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={groupRenameBusy}
                  onClick={() => {
                    setEditingGroupName(false);
                    setGroupError(null);
                  }}
                >
                  Cancel
                </button>
                {renameCheck?.kind === 'exact' && (
                  <p className="w-full text-xs text-[var(--muted)]">These services join the existing group {renameCheck.match}.</p>
                )}
                {renameCheck?.kind === 'similar' && renameCheck.match && (
                  <div role="status" className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--amber-light)] px-3 py-2 text-xs text-[var(--amber-strong)]">
                    <span>You already have {renameCheck.match}. Use that?</span>
                    <button type="button" className="min-h-8 rounded-md border border-current px-2.5 font-semibold" onClick={() => setGroupNameDraft(renameCheck.match ?? groupNameDraft)}>
                      Use {renameCheck.match}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--ink)]">{category}</h3>
                <span className="text-hint text-[var(--muted)]">
                  {items.length} item{items.length === 1 ? '' : 's'}
                </span>
                <CatalogActionButton onClick={() => setEditingGroupName(true)}>Rename group</CatalogActionButton>
              </div>
            )}
            <ErrorNote message={groupError} />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 sm:shrink-0">
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-hint font-semibold text-[var(--ink)] hover:bg-[var(--paper)]"
            onClick={() => {
              setCollapsed(false);
              setAddKind('single');
            }}
          >
            + One visit
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--teal)] bg-[var(--teal-light)] px-2.5 py-1 text-hint font-semibold text-[var(--teal-strong)] hover:opacity-90"
            onClick={() => {
              setCollapsed(false);
              setAddKind('package');
            }}
          >
            + Package
          </button>
        </div>
      </div>
      {open && (
        <div className="divide-y divide-[var(--border)]">
          {items.map((item) => (
            <ServiceCatalogItemRow key={item.id} item={item} groupNames={groupNames} />
          ))}
        </div>
      )}
      {open && addKind && (
        <div className="border-t border-[var(--border)] bg-[var(--paper)] p-3">
          <ServiceCatalogInlineAdd
            category={category}
            kind={addKind}
            onDone={() => setAddKind(null)}
            onCancel={() => setAddKind(null)}
          />
        </div>
      )}
    </div>
  );
}

function ServiceCatalogItemRow({
  item,
  groupNames,
  showCategory = false,
}: {
  item: CatalogItem;
  groupNames: string[];
  /** Shown in the Inactive services section, where the item is no longer
   *  nested inside its group's own panel, so the group needs restating. */
  showCategory?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState(item.category);
  const [creatingNewGroup, setCreatingNewGroup] = useState(false);
  const [name, setName] = useState(item.name);
  const allServices = useContext(AllServicesContext);
  const check = nameCheck(name, allServices, { selfId: item.id });
  const newGroupCheck = creatingNewGroup ? groupNameCheck(category, groupNames) : null;
  const [sessionCount, setSessionCount] = useState(String(item.sessionCount));
  const [pricePaise, setPricePaise] = useState<number | null>(item.basePricePaise);
  const [duration, setDuration] = useState(item.durationMinutes != null ? String(item.durationMinutes) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Indexed count, not a full fetch — resolves near-instantly from the
  // local Dexie cache. Only ever consulted for inactive items.
  const usageCount = useLiveQuery(
    () => (item.active ? undefined : repos.visits.countByService(item.id)),
    [item.id, item.active]
  );

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await catalogService.hardDelete(item.id);
      setDeleteConfirm(false);
    } catch (e) {
      setDeleteError(toFriendlyMessage(e));
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!editing) {
      setCategory(item.category);
      setCreatingNewGroup(false);
      setName(item.name);
      setSessionCount(String(item.sessionCount));
      setPricePaise(item.basePricePaise);
      setDuration(item.durationMinutes != null ? String(item.durationMinutes) : '');
    }
  }, [item, editing]);

  async function save() {
    if (!name.trim() || !category.trim() || pricePaise == null) {
      setError('Group, name, and price are required');
      return;
    }
    const durationMinutes = parseDuration(duration);
    if (durationMinutes === undefined) {
      setError(DURATION_ERROR);
      return;
    }
    if (nameCheckBlocks(check)) return;
    const sessions = Math.max(1, Number(sessionCount) || 1);
    setSaving(true);
    setError(null);
    try {
      await catalogService.updateService({
        ...item,
        durationMinutes,
        category: category.trim(),
        name: name.trim(),
        sessionCount: sessions,
        basePricePaise: pricePaise,
        updatedAt: new Date().toISOString(),
      });
      setEditing(false);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      setSavedFlash(true);
      savedTimeoutRef.current = setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    await repos.catalog.put({
      ...item,
      active: !item.active,
      updatedAt: new Date().toISOString(),
    });
  }

  // Live per-session readout while editing — recomputed from the draft
  // fields on every keystroke, same math as the read-only row, so a
  // price/session-count edit shows its real per-session effect before
  // Save is even clicked.
  const draftSessionCount = Math.max(1, Number(sessionCount) || 1);
  const livePerSession =
    pricePaise != null && draftSessionCount > 1
      ? formatINR(effectivePricePerSession({ basePricePaise: pricePaise, sessionCount: draftSessionCount }))
      : null;

  if (editing) {
    return (
      <div
        className={`space-y-4 rounded-xl border border-[var(--teal)]/30 bg-[var(--surface)] p-4 shadow-[var(--shadow-2)] ${item.active ? '' : 'opacity-60'}`}
      >
        <p className="text-sm font-semibold text-[var(--ink)]">Edit service</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Service group">
            {creatingNewGroup ? (
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="New group name"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => {
                    setCreatingNewGroup(false);
                    setCategory(item.category);
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <select
                className={inputCls}
                value={category}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setCreatingNewGroup(true);
                    setCategory('');
                  } else {
                    setCategory(e.target.value);
                  }
                }}
              >
                {groupNames.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
                <option value="__new__">+ Create a new group…</option>
              </select>
            )}
            {newGroupCheck?.kind === 'exact' && (
              <p className="mt-1 text-xs text-[var(--muted)]">This service joins the existing group {newGroupCheck.match}.</p>
            )}
            {newGroupCheck?.kind === 'similar' && newGroupCheck.match && (
              <div role="status" className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--amber-light)] px-3 py-2 text-xs text-[var(--amber-strong)]">
                <span>You already have {newGroupCheck.match}. Use that?</span>
                <button
                  type="button"
                  className="min-h-8 rounded-md border border-current px-2.5 font-semibold"
                  onClick={() => {
                    setCategory(newGroupCheck.match ?? category);
                    setCreatingNewGroup(false);
                  }}
                >
                  Use {newGroupCheck.match}
                </button>
              </div>
            )}
          </Field>
          <Field label="Name on visits & invoices">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <NameCheckNote result={check} hiddenText="is in No longer offered" onUse={setName} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Session count">
            <input
              type="number"
              min={1}
              className={inputCls}
              value={sessionCount}
              onChange={(e) => setSessionCount(e.target.value)}
            />
          </Field>
          <Field
            label="Total price"
            hint={
              livePerSession && (
                <>
                  {livePerSession} per session, across {draftSessionCount} sessions
                </>
              )
            }
          >
            <RupeeInput valuePaise={pricePaise} onChange={setPricePaise} />
          </Field>
        </div>
        <Field label="Duration (minutes, optional)" hint={DURATION_HINT}>
          <input
            type="number"
            min={1}
            max={480}
            step={1}
            className={inputCls}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
        <p className="text-hint text-[var(--muted)]">
          Use <strong>1</strong> for a single visit, <strong>2+</strong> for a package (one line item,
          sessions tracked on visits). New price applies to future visits only.
        </p>
        <ErrorNote message={error} />
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={btnPrimary} disabled={saving || nameCheckBlocks(check)} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className={btnSecondary} disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 px-3 py-2.5 ${item.active ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-[var(--ink)]">{item.name}</p>
        <span className="text-[var(--muted)]" aria-hidden>
          ·
        </span>
        <span className="text-sm font-semibold text-[var(--ink)]">
          {formatINR(item.basePricePaise)}
        </span>
        {item.sessionCount > 1 && (
          <span className="text-xs text-[var(--muted)]">
            · {formatINR(effectivePricePerSession(item))}/session
          </span>
        )}
        {item.durationMinutes != null && (
          <span className="text-xs text-[var(--muted)]">{`· ${item.durationMinutes} min`}</span>
        )}
        <div className="ml-auto flex shrink-0 flex-wrap gap-2">
          <CatalogActionButton onClick={() => setEditing(true)}>Edit</CatalogActionButton>
          <CatalogActionButton tone={item.active ? 'rust' : 'teal'} onClick={() => void toggleActive()}>
            {item.active ? 'Stop offering' : 'Offer again'}
          </CatalogActionButton>
          {!item.active && usageCount === 0 && (
            <CatalogActionButton tone="rust" onClick={() => setDeleteConfirm(true)}>
              Delete
            </CatalogActionButton>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showCategory && <span className="text-xs text-[var(--muted)]">{item.category}</span>}
        <SessionKindPill sessionCount={item.sessionCount} />
        {!item.active && !showCategory && <InactivePill />}
        {!item.active && usageCount != null && usageCount > 0 && (
          <span className="text-hint text-[var(--muted)]">
            Used on {usageCount} visit{usageCount === 1 ? '' : 's'} — can't delete
          </span>
        )}
        {savedFlash && <span className="text-xs text-[var(--moss)]">Saved</span>}
      </div>
      <ErrorNote message={deleteError} />
      <ConfirmDialog
        open={deleteConfirm}
        title="Delete this service?"
        message={`Permanently delete "${item.name}"? This cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        destructive
        onCancel={() => setDeleteConfirm(false)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function ServiceCatalogInlineAdd({
  category,
  kind,
  onDone,
  onCancel,
}: {
  category: string;
  kind: CatalogAddKind;
  onDone: () => void;
  onCancel: () => void;
}) {
  const clinic = useClinic();
  const defaultSessions = kind === 'package' ? '5' : '1';
  const [name, setName] = useState('');
  const allServices = useContext(AllServicesContext);
  const check = nameCheck(name, allServices);

  /** "Offer it again": switches the stopped service with this name back on, instead of adding a second one. */
  async function offerAgain(match: CatalogItem) {
    setSaving(true);
    setError(null);
    try {
      await repos.catalog.put({ ...match, active: true, updatedAt: new Date().toISOString() });
      onDone();
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  const [sessionCount, setSessionCount] = useState(defaultSessions);
  const [pricePaise, setPricePaise] = useState<number | null>(null);
  const [duration, setDuration] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || pricePaise == null) {
      setError('Name and price are required');
      return;
    }
    const durationMinutes = parseDuration(duration);
    if (durationMinutes === undefined) {
      setError(DURATION_ERROR);
      return;
    }
    const sessions = Math.max(1, Number(sessionCount) || 1);
    if (kind === 'single' && sessions !== 1) {
      setError('One-visit services have 1 session — use + Package for more than one.');
      return;
    }
    if (kind === 'package' && sessions < 2) {
      setError('Packages need at least 2 sessions.');
      return;
    }
    if (nameCheckBlocks(check)) return;
    setSaving(true);
    setError(null);
    try {
      await catalogService.addService({
        id: crypto.randomUUID(),
        clinicId: clinic.id,
        category,
        name: name.trim(),
        sessionCount: sessions,
        basePricePaise: pricePaise,
        durationMinutes,
        active: true,
        updatedAt: new Date().toISOString(),
      });
      onDone();
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-[var(--ink)]">
        {kind === 'package' ? 'Add package to this group' : 'Add a one-visit service'}
      </p>
      <Field label="Name">
        <input
          className={inputCls}
          placeholder={kind === 'package' ? 'e.g. 5-session physio package' : 'e.g. Follow-up consultation'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <NameCheckNote
          result={check}
          hiddenText="is in No longer offered"
          restoreLabel="Offer it again"
          onRestore={(m) => void offerAgain(m)}
          onUse={setName}
        />
      </Field>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Field label="Session count">
          <input
            type="number"
            min={kind === 'package' ? 2 : 1}
            max={kind === 'single' ? 1 : undefined}
            className={inputCls}
            value={sessionCount}
            onChange={(e) => setSessionCount(e.target.value)}
            readOnly={kind === 'single'}
          />
        </Field>
        <Field label="Total price">
          <RupeeInput valuePaise={pricePaise} onChange={setPricePaise} />
        </Field>
      </div>
      <Field label="Duration (minutes, optional)" hint={DURATION_HINT}>
        <input
          type="number"
          min={1}
          max={480}
          step={1}
          className={inputCls}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
      </Field>
      <ErrorNote message={error} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={saving || nameCheckBlocks(check)} onClick={() => void save()}>
          {saving ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className={btnSecondary} disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function NewServiceGroupForm({ existingGroupNames }: { existingGroupNames: string[] }) {
  const [groupName, setGroupName] = useState('');
  const [addKind, setAddKind] = useState<CatalogAddKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = groupNameCheck(groupName, existingGroupNames);
  // Typing an existing group's name (capitals ignored) adds to that group, under its spelling.
  const trimmed = check.kind === 'exact' && check.match ? check.match : groupName.trim();

  function startAdd(kind: CatalogAddKind) {
    if (!trimmed) {
      setError('Enter a group name first');
      return;
    }
    setError(null);
    setAddKind(kind);
  }

  return (
    <CatalogAddCard
      title="Add a service group"
      hint="Groups organize the visit picker (Consultation, Assessment, Physiotherapy, …). Add at least one service or package in the group."
    >
      <Field label="Group name">
        <input
          className={inputCls}
          list="catalog-service-groups"
          placeholder="e.g. Physiotherapy"
          value={groupName}
          onChange={(e) => {
            setGroupName(e.target.value);
            setAddKind(null);
            setError(null);
          }}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={() => startAdd('single')}>
          + First one-visit service
        </button>
        <button type="button" className={btnSecondary} onClick={() => startAdd('package')}>
          + First package
        </button>
      </div>
      {check.kind === 'exact' && <p className="text-xs text-[var(--muted)]">{check.match} already exists: this adds to it.</p>}
      {check.kind === 'similar' && check.match && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--amber-light)] px-3 py-2 text-xs text-[var(--amber-strong)]">
          <span>You already have {check.match}. Use that?</span>
          <button type="button" className="min-h-8 rounded-md border border-current px-2.5 font-semibold" onClick={() => setGroupName(check.match ?? groupName)}>
            Use {check.match}
          </button>
        </div>
      )}
      {addKind && trimmed && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <ServiceCatalogInlineAdd
            category={trimmed}
            kind={addKind}
            onDone={() => {
              setGroupName('');
              setAddKind(null);
            }}
            onCancel={() => setAddKind(null)}
          />
        </div>
      )}
      <ErrorNote message={error} />
    </CatalogAddCard>
  );
}

function TreatmentCatalog() {
  const clinic = useClinic();
  const itemsRaw = useLiveQuery(() => repos.treatmentCatalog.list(clinic.id, true), [clinic.id]);
  const [showInactive, setShowInactive] = useState(false);
  const visible = useMemo(
    () =>
      [...(itemsRaw ?? [])]
        .filter((i) => showInactive || i.active)
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    [itemsRaw, showInactive]
  );
  const activeCount = (itemsRaw ?? []).filter((i) => i.active).length;
  const itemList = itemsRaw ?? [];

  return (
    <SectionCard id="settings-card-services-treatments" title="Treatments">
      <p className="mb-3 text-xs text-[var(--muted)]">
        What you did in the session, for your clinical record. Not on the bill. Shown as quick picks on each visit,
        most used first. Hide a treatment instead of deleting it, so past visits keep showing it.
      </p>
      {itemList.length - activeCount > 0 && (
        <label className="mb-4 flex items-center gap-2 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show hidden ({itemList.length - activeCount})
        </label>
      )}
      {visible.length > 0 ? (
        <div className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => (
            <TreatmentCard key={item.id} item={item} all={itemList} />
          ))}
        </div>
      ) : (
        <p className="mb-6 text-xs text-[var(--muted)]">No treatments yet.</p>
      )}
      <TreatmentAddForm all={itemList} />
    </SectionCard>
  );
}

function TreatmentCard({ item, all }: { item: TreatmentItem; all: TreatmentItem[] }) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(item.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = nameCheck(nameDraft, all, { selfId: item.id });

  useEffect(() => {
    if (!editing) setNameDraft(item.name);
  }, [item.name, editing]);

  async function save() {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    if (nameCheckBlocks(check)) return;
    setSaving(true);
    setError(null);
    try {
      await catalogService.updateTreatment({
        ...item,
        name: trimmed,
        updatedAt: new Date().toISOString(),
      });
      setEditing(false);
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    await repos.treatmentCatalog.put({
      ...item,
      active: !item.active,
      updatedAt: new Date().toISOString(),
    });
  }

  if (editing) {
    return (
      <CatalogCardShell
        active={item.active}
        footer={
          <>
            <button type="button" className={btnPrimary} disabled={saving || nameCheckBlocks(check)} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={btnSecondary} disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        }
      >
        <Field label="Treatment name">
          <input className={inputCls} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
          <NameCheckNote result={check} hiddenText="is hidden" onUse={setNameDraft} />
        </Field>
        <ErrorNote message={error} />
      </CatalogCardShell>
    );
  }

  return (
    <CatalogCardShell
      active={item.active}
      footer={
        <>
          <CatalogActionButton onClick={() => setEditing(true)}>Edit</CatalogActionButton>
          <CatalogActionButton tone={item.active ? 'rust' : 'teal'} onClick={() => void toggleActive()}>
            {item.active ? 'Hide' : 'Show'}
          </CatalogActionButton>
        </>
      }
    >
      <p className="text-sm font-medium text-[var(--ink)]">{item.name}</p>
      {!item.active && <InactivePill />}
    </CatalogCardShell>
  );
}

function TreatmentAddForm({ all }: { all: TreatmentItem[] }) {
  const clinic = useClinic();
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const check = nameCheck(draftName, all);

  async function addItem() {
    setError(null);
    const name = draftName.trim();
    if (!name) {
      setError('Name is required');
      return;
    }
    if (nameCheckBlocks(check)) return;
    try {
      await catalogService.addTreatment({
        id: crypto.randomUUID(),
        clinicId: clinic.id,
        name,
        active: true,
        updatedAt: new Date().toISOString(),
      });
      setDraftName('');
    } catch (e) {
      setError(saveErrorMessage(e));
    }
  }

  /** "Show it again": switches the hidden treatment with this name back on, instead of adding a second one. */
  async function showAgain(match: TreatmentItem) {
    try {
      await repos.treatmentCatalog.put({ ...match, active: true, updatedAt: new Date().toISOString() });
      setDraftName('');
    } catch (e) {
      setError(saveErrorMessage(e));
    }
  }

  return (
    <CatalogAddCard title="Add a treatment" hint="e.g. Manual therapy, Exercise, Electrotherapy.">
      <div className="flex flex-wrap gap-2">
        <input
          className={`${inputCls} min-w-0 flex-1`}
          placeholder="Treatment name"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addItem();
          }}
        />
        <button type="button" className={btnSecondary} disabled={nameCheckBlocks(check)} onClick={() => void addItem()}>
          + Add
        </button>
      </div>
      <NameCheckNote result={check} hiddenText="is hidden" restoreLabel="Show it again" onRestore={(m) => void showAgain(m)} onUse={setDraftName} />
      <ErrorNote message={error} />
    </CatalogAddCard>
  );
}

/** "How patients found you": the referral sources staff pick when adding a patient. Lives on the General tab. */
export function ReferralSourcesCard() {
  const clinic = useClinic();
  const itemsRaw = useLiveQuery(() => repos.referringSourceCatalog.list(clinic.id, true), [clinic.id]);
  const [showInactive, setShowInactive] = useState(false);
  const visible = useMemo(
    () =>
      [...(itemsRaw ?? [])]
        .filter((i) => showInactive || i.active)
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    [itemsRaw, showInactive]
  );
  const itemList = itemsRaw ?? [];
  const activeCount = itemList.filter((i) => i.active).length;

  return (
    <SectionCard id={REFERRALS_CARD_ID} title="How patients found you">
      <p className="mb-3 text-xs text-[var(--muted)]">
        Asked when you add a patient. Feeds the Referral sources report. Hide a source instead of deleting it, so
        existing patients keep showing it. Optionally add a <strong>detail field label</strong>: when staff pick that
        source, the patient form shows an extra box with that label (e.g. &quot;Referring doctor&quot;).
      </p>
      {itemList.length - activeCount > 0 && (
        <label className="mb-4 flex items-center gap-2 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show hidden ({itemList.length - activeCount})
        </label>
      )}
      {visible.length > 0 ? (
        <div className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => (
            <ReferralSourceCard key={item.id} item={item} all={itemList} />
          ))}
        </div>
      ) : (
        <p className="mb-6 text-xs text-[var(--muted)]">No referral sources yet.</p>
      )}
      <ReferralSourceAddForm all={itemList} />
    </SectionCard>
  );
}

function ReferralSourceCard({ item, all }: { item: ReferringSourceItem; all: ReferringSourceItem[] }) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(item.name);
  const [detailDraft, setDetailDraft] = useState(item.detailLabel ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = nameCheck(nameDraft, all, { selfId: item.id });

  useEffect(() => {
    if (!editing) {
      setNameDraft(item.name);
      setDetailDraft(item.detailLabel ?? '');
    }
  }, [item, editing]);

  async function save() {
    const name = nameDraft.trim();
    if (!name) {
      setError('Name is required');
      return;
    }
    if (nameCheckBlocks(check)) return;
    setSaving(true);
    setError(null);
    try {
      await catalogService.updateReferralSource({
        ...item,
        name,
        detailLabel: detailDraft.trim() || null,
        updatedAt: new Date().toISOString(),
      });
      setEditing(false);
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    await repos.referringSourceCatalog.put({
      ...item,
      active: !item.active,
      updatedAt: new Date().toISOString(),
    });
  }

  if (editing) {
    return (
      <CatalogCardShell
        active={item.active}
        footer={
          <>
            <button type="button" className={btnPrimary} disabled={saving || nameCheckBlocks(check)} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={btnSecondary} disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        }
      >
        <Field label="Source name">
          <input className={inputCls} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
          <NameCheckNote result={check} hiddenText="is hidden" onUse={setNameDraft} />
        </Field>
        <Field label="Detail field label (optional)">
          <input
            className={inputCls}
            placeholder="e.g. Referring doctor"
            value={detailDraft}
            onChange={(e) => setDetailDraft(e.target.value)}
          />
          <p className="mt-1 text-hint text-[var(--muted)]">
            Leave blank if patients only need to pick the source name — no follow-up field.
          </p>
        </Field>
        <ErrorNote message={error} />
      </CatalogCardShell>
    );
  }

  return (
    <CatalogCardShell
      active={item.active}
      footer={
        <>
          <CatalogActionButton onClick={() => setEditing(true)}>Edit</CatalogActionButton>
          <CatalogActionButton tone={item.active ? 'rust' : 'teal'} onClick={() => void toggleActive()}>
            {item.active ? 'Hide' : 'Show'}
          </CatalogActionButton>
        </>
      }
    >
      <p className="text-sm font-medium text-[var(--ink)]">{item.name}</p>
      {!item.active && <InactivePill />}
      {item.detailLabel ? (
        <p className="text-hint text-[var(--muted)]">
          Detail field: <span className="text-[var(--ink)]">{item.detailLabel}</span>
        </p>
      ) : null}
    </CatalogCardShell>
  );
}

function ReferralSourceAddForm({ all }: { all: ReferringSourceItem[] }) {
  const clinic = useClinic();
  const [draftName, setDraftName] = useState('');
  const [draftDetailLabel, setDraftDetailLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const check = nameCheck(draftName, all);

  async function addItem() {
    setError(null);
    const name = draftName.trim();
    if (!name) {
      setError('Name is required');
      return;
    }
    if (nameCheckBlocks(check)) return;
    try {
      await catalogService.addReferralSource({
        id: crypto.randomUUID(),
        clinicId: clinic.id,
        name,
        detailLabel: draftDetailLabel.trim() || null,
        active: true,
        updatedAt: new Date().toISOString(),
      });
      setDraftName('');
      setDraftDetailLabel('');
    } catch (e) {
      setError(saveErrorMessage(e));
    }
  }

  /** "Show it again": switches the hidden source with this name back on, instead of adding a second one. */
  async function showAgain(match: ReferringSourceItem) {
    try {
      await repos.referringSourceCatalog.put({ ...match, active: true, updatedAt: new Date().toISOString() });
      setDraftName('');
      setDraftDetailLabel('');
    } catch (e) {
      setError(saveErrorMessage(e));
    }
  }

  return (
    <CatalogAddCard
      title="Add a referral source"
      hint='e.g. "Instagram ad" or "Doctor referral" with detail "Referring doctor".'
    >
      <div className="space-y-2">
        <input
          className={inputCls}
          placeholder="Source name"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addItem();
          }}
        />
        <input
          className={inputCls}
          placeholder="Detail field label (optional)"
          value={draftDetailLabel}
          onChange={(e) => setDraftDetailLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addItem();
          }}
        />
        <NameCheckNote result={check} hiddenText="is hidden" restoreLabel="Show it again" onRestore={(m) => void showAgain(m)} onUse={setDraftName} />
        <button type="button" className={`${btnSecondary} w-full`} disabled={nameCheckBlocks(check)} onClick={() => void addItem()}>
          + Add
        </button>
        <ErrorNote message={error} />
      </div>
    </CatalogAddCard>
  );
}
