import { useEffect, useId, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { repos, catalogService } from '@/services';
import type { CatalogItem } from '@/domain/types';
import { formatINR } from '@/domain/money';
import { OTHER_GROUP, orderedServices, perSessionLabel, serviceSubline, usageLabel } from '@/domain/catalogDisplay';
import { groupNameCheck } from '@/domain/nameCheck';
import { btnPrimary, btnSecondary, Field, inputCls, LoadingRows, SectionCard, SheetDialog } from '@/components/ui';
import { useIsDesktop } from '@/components/useMediaQuery';
import { HiddenItemsFooter, MiniSwitch, saveErrorMessage } from './catalogShared';
import { ServiceFormSheet, type ServiceSheetMode } from './ServiceFormSheet';
import { useShowUsage } from './useShowUsage';

/** The search box appears only for lists longer than this (most clinics have 6). */
const SEARCH_ABOVE = 8;
/** How long a just-saved row stays highlighted. */
const FLASH_MS = 1600;

/**
 * Services and prices. One list card on phones (group names as small sticky headings inside it), a table from the
 * `desktop:` width up; every row opens the same sheet. Named groups first, ungrouped last under "Other"
 * (`orderedServices`, the same rule as the visit picker). Usage counts follow "Show usage" (on by default, per
 * device), except where they decide something: the edit sheet and the "Inactive" footer.
 */
export function ServicesView() {
  const clinic = useClinic();
  const items = useLiveQuery(() => repos.catalog.list(clinic.id, true), [clinic.id]);
  const usage = useLiveQuery(() => catalogService.usageCounts(clinic.id), [clinic.id]) ?? EMPTY_USAGE;
  const [showUsage, setShowUsage] = useShowUsage('services');
  const isDesktop = useIsDesktop();
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState<ServiceSheetMode | null>(null);
  const [groupSheet, setGroupSheet] = useState<string | null>(null);
  const [footerOpen, setFooterOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flashId]);

  const all = useMemo(() => items ?? [], [items]);
  const offered = useMemo(() => all.filter((i) => i.active), [all]);
  const query = search.trim().toLowerCase();
  const matches = (i: CatalogItem) => !query || i.name.toLowerCase().includes(query) || (i.category ?? '').toLowerCase().includes(query);
  const rows = useMemo(() => orderedServices(offered.filter(matches)), [offered, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const stopped = useMemo(
    () => all.filter((i) => !i.active && matches(i)).sort((a, b) => a.name.localeCompare(b.name)),
    [all, query] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const blocks = useMemo(() => {
    const out: { heading: string; items: CatalogItem[] }[] = [];
    for (const { item, heading } of rows) {
      const last = out[out.length - 1];
      if (last && last.heading === heading) last.items.push(item);
      else out.push({ heading, items: [item] });
    }
    return out;
  }, [rows]);
  const groupNames = useMemo(() => [...new Set(all.map((i) => (i.category ?? '').trim()).filter(Boolean))].sort(), [all]);
  const showSearch = offered.length > SEARCH_ABOVE || query !== '';

  const openAdd = () => setSheet({ kind: 'add' });
  const openEdit = (item: CatalogItem) => setSheet({ kind: 'edit', item });
  const usageFor = (item: CatalogItem) => (showUsage ? usage.get(item.id) ?? 0 : undefined);

  return (
    <SectionCard
      id="settings-card-services-packages"
      title="Services and prices"
      action={
        <button type="button" className={`${btnPrimary} min-h-9 px-3 text-sm`} onClick={openAdd}>
          + Add
        </button>
      }
    >
      <p className="mb-2 text-xs text-[var(--muted)]">
        What patients pay for. You pick these on a visit, and they print on bills and invoices.
      </p>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">Charge for the visit or the package. Record what you did in the session under Treatments.</p>
        <MiniSwitch label="Show usage" checked={showUsage} onChange={setShowUsage} />
      </div>
      {showSearch && (
        <input
          type="search"
          className={`${inputCls} mb-3`}
          placeholder="Search services…"
          aria-label="Search services"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {items === undefined ? (
        <LoadingRows label="Loading services" />
      ) : rows.length === 0 ? (
        <p className="py-4 text-sm text-[var(--muted)]">
          {query
            ? `No services match "${search.trim()}".`
            : stopped.length > 0
              ? 'No active services. Turn one back on under Inactive, or add one with "+ Add".'
              : 'No services yet. Add the first one with "+ Add".'}
        </p>
      ) : isDesktop ? (
        <ServicesTable rows={rows} usage={usage} showUsage={showUsage} flashId={flashId} onEdit={openEdit} onGroup={setGroupSheet} />
      ) : (
        <div className="overflow-clip rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          {blocks.map((block, b) => (
            // One block per group (heading plus all its rows): a sticky heading only stays at the top while its own
            // block is on screen. The divider sits on the block; its first child drops its own top border.
            <div key={block.heading || 'flat'} className={b === 0 ? '' : 'border-t border-[var(--border)]'}>
              {block.heading && (
                <GroupHeading name={block.heading} onOpen={block.heading === OTHER_GROUP ? undefined : () => setGroupSheet(block.heading)} />
              )}
              {block.items.map((item) => (
                <ServiceRow key={item.id} item={item} usage={usageFor(item)} flash={item.id === flashId} onOpen={() => openEdit(item)} />
              ))}
            </div>
          ))}
          <button
            type="button"
            className="flex min-h-12 w-full items-center gap-2 border-t border-dashed border-[var(--border)] px-3 text-left text-sm font-semibold text-[var(--teal-strong)] active:bg-[var(--paper)]"
            onClick={openAdd}
          >
            + Add a service
          </button>
        </div>
      )}

      <HiddenItemsFooter label="Inactive" count={stopped.length} open={footerOpen || query !== ''} onToggle={() => setFooterOpen((v) => !v)}>
        {stopped.map((item) => {
          const used = usage.get(item.id) ?? 0;
          return (
            <ServiceRow
              key={item.id}
              item={item}
              note={used > 0 ? usageLabel(used) : 'Not used yet · can be deleted'}
              flash={item.id === flashId}
              onOpen={() => openEdit(item)}
            />
          );
        })}
      </HiddenItemsFooter>

      <ServiceFormSheet
        mode={sheet}
        allItems={all}
        groupNames={groupNames}
        usage={usage}
        onClose={() => setSheet(null)}
        onSaved={(id) => {
          setSheet(null);
          setFlashId(id);
        }}
      />
      {groupSheet !== null && (
        <GroupSheet
          key={groupSheet}
          name={groupSheet}
          count={all.filter((i) => (i.category ?? '').trim() === groupSheet).length}
          groupNames={groupNames}
          onClose={() => setGroupSheet(null)}
        />
      )}
    </SectionCard>
  );
}

const EMPTY_USAGE = new Map<string, number>();

function GroupHeading({ name, onOpen }: { name: string; onOpen?: () => void }) {
  const cls =
    'sticky top-[var(--app-header-h,0px)] z-[1] flex min-h-9 w-full items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--paper)] px-3 text-left text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted)] first:border-t-0';
  if (!onOpen) return <div className={cls}>{name}</div>;
  return (
    <button type="button" className={cls} aria-label={`Group ${name}: rename or remove`} onClick={onOpen}>
      {name}
      <span aria-hidden="true" className="text-base font-normal normal-case text-[var(--muted)]">›</span>
    </button>
  );
}

/** One tappable service row: name (wraps, never cut), the line under it, price, and a ›. */
function ServiceRow({
  item,
  usage,
  note,
  flash,
  onOpen,
}: {
  item: CatalogItem;
  usage?: number;
  /** Replaces the usage chip's text (the "Inactive" footer always shows usage). */
  note?: string;
  flash: boolean;
  onOpen: () => void;
}) {
  const sub = serviceSubline(item);
  // How much it is used is a different kind of fact from what the service is: its own chip on its own line.
  const usageText = note ?? (usage !== undefined ? usageLabel(usage) : null);
  const subId = useId();
  return (
    <button
      type="button"
      aria-label={`Edit ${item.name}, ${formatINR(item.basePricePaise)}`}
      aria-describedby={sub ? subId : undefined}
      className={`flex min-h-11 w-full items-center gap-3 border-t border-[var(--border)] px-3 py-2.5 text-left transition-colors first:border-t-0 hover:bg-[var(--paper)] active:bg-[var(--paper)] ${
        flash ? 'bg-[var(--teal-light)]' : ''
      }`}
      onClick={onOpen}
    >
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium text-[var(--ink)]">{item.name}</span>
        {sub && <span id={subId} className="block text-xs text-[var(--muted)]">{sub}</span>}
        {usageText && (
          <span className="mt-1 inline-block rounded-full bg-[var(--slate-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--slate)]">{usageText}</span>
        )}
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--ink)]">{formatINR(item.basePricePaise)}</span>
      <span aria-hidden="true" className="shrink-0 text-lg text-[var(--muted)]">›</span>
    </button>
  );
}

/** From the desktop width up: the same rows as columns. Rows are focusable; Enter or a click opens the sheet. */
function ServicesTable({
  rows,
  usage,
  showUsage,
  flashId,
  onEdit,
  onGroup,
}: {
  rows: { item: CatalogItem; heading: string }[];
  usage: Map<string, number>;
  showUsage: boolean;
  flashId: string | null;
  onEdit: (item: CatalogItem) => void;
  onGroup: (name: string) => void;
}) {
  const cols = showUsage ? 7 : 6;
  const dash = <span className="text-[var(--muted)]">—</span>;
  const activate = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr className="bg-[var(--paper)] text-left text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            <th className="px-3.5 py-2.5 font-semibold">Service</th>
            <th className="px-3.5 py-2.5 text-right font-semibold">Sessions</th>
            <th className="px-3.5 py-2.5 text-right font-semibold">Price</th>
            <th className="px-3.5 py-2.5 text-right font-semibold">Each</th>
            <th className="px-3.5 py-2.5 text-right font-semibold">Length</th>
            {showUsage && <th className="px-3.5 py-2.5 text-right font-semibold">Used</th>}
            <th className="w-16 px-3.5 py-2.5"><span className="sr-only">Edit</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, heading }, i) => {
            const isPackage = item.sessionCount > 1;
            const used = usage.get(item.id) ?? 0;
            const showHeading = heading && heading !== rows[i - 1]?.heading;
            return [
              showHeading ? (
                heading === OTHER_GROUP ? (
                  <tr key={`h-${heading}`} className="border-t border-[var(--border)] bg-[var(--paper)]">
                    <td colSpan={cols} className="px-3.5 py-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted)]">{heading}</td>
                  </tr>
                ) : (
                  <tr
                    key={`h-${heading}`}
                    tabIndex={0}
                    aria-label={`Group ${heading}: rename or remove`}
                    className="group cursor-pointer border-t border-[var(--border)] bg-[var(--paper)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--teal)]"
                    onClick={() => onGroup(heading)}
                    onKeyDown={activate(() => onGroup(heading))}
                  >
                    <td colSpan={cols} className="px-3.5 py-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      {heading}
                      <span className="float-right font-medium normal-case tracking-normal text-transparent group-hover:text-[var(--teal-strong)] group-focus-visible:text-[var(--teal-strong)]">
                        Rename ›
                      </span>
                    </td>
                  </tr>
                )
              ) : null,
              <tr
                key={item.id}
                tabIndex={0}
                aria-label={`Edit ${item.name}, ${formatINR(item.basePricePaise)}`}
                className={`group cursor-pointer border-t border-[var(--border)] outline-none hover:bg-[var(--teal-light)] focus-visible:bg-[var(--teal-light)] ${
                  item.id === flashId ? 'bg-[var(--teal-light)]' : ''
                }`}
                onClick={() => onEdit(item)}
                onKeyDown={activate(() => onEdit(item))}
              >
                <td className="break-words px-3.5 py-2.5 text-[var(--ink)]">{item.name}</td>
                <td className="px-3.5 py-2.5 text-right">{isPackage ? item.sessionCount : dash}</td>
                <td className="px-3.5 py-2.5 text-right font-semibold">{formatINR(item.basePricePaise)}</td>
                <td className="px-3.5 py-2.5 text-right">{isPackage ? perSessionLabel(item).replace(' each', '') : dash}</td>
                <td className="px-3.5 py-2.5 text-right">{item.durationMinutes != null ? `${item.durationMinutes} min` : dash}</td>
                {showUsage && (
                  <td className={`whitespace-nowrap px-3.5 py-2.5 text-right ${used ? '' : 'text-[var(--muted)]'}`}>{used ? used : 'Not used yet'}</td>
                )}
                <td className="px-3.5 py-2.5 text-right text-xs font-semibold text-transparent group-hover:text-[var(--teal-strong)] group-focus-visible:text-[var(--teal-strong)]">
                  Edit ›
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Tap a group heading: rename the group (every service moves, in one write) or remove it (keeps the services). */
function GroupSheet({ name, count, groupNames, onClose }: { name: string; count: number; groupNames: string[]; onClose: () => void }) {
  const clinic = useClinic();
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const check = groupNameCheck(draft, groupNames, name);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetDialog
      open
      title={`Group: ${name}`}
      onClose={onClose}
      busy={busy}
      error={error}
      footer={
        <>
          <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy}
            onClick={() => {
              if (!draft.trim()) return setError('Group name is required');
              if (draft.trim() === name) return onClose();
              void run(() => catalogService.renameGroup(clinic.id, name, draft));
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <Field label="Group name" htmlFor={inputId} hint={`${count} service${count === 1 ? '' : 's'}. Renaming moves them all at once.`}>
        <input id={inputId} className={inputCls} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus autoComplete="off" />
      </Field>
      {check.kind === 'exact' && <p className="mt-2 text-hint text-[var(--muted)]">These services join the existing group {check.match}.</p>}
      {check.kind === 'similar' && check.match && (
        <div role="status" className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--amber-light)] px-3 py-2 text-xs text-[var(--amber-strong)]">
          <span>You already have {check.match}. Use that?</span>
          <button type="button" className="min-h-8 rounded-md border border-current px-2.5 font-semibold" onClick={() => setDraft(check.match ?? draft)}>
            Use {check.match}
          </button>
        </div>
      )}
      <button
        type="button"
        className="mt-5 min-h-9 text-sm font-medium text-[var(--rust)] underline disabled:opacity-50"
        disabled={busy}
        onClick={() => void run(() => catalogService.removeGroup(clinic.id, name))}
      >
        Remove group (keeps the services)
      </button>
    </SheetDialog>
  );
}
