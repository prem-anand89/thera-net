import { useEffect, useMemo, useRef, useState } from 'react';
import { formatINR, roundToRupeeHalfUp } from '@/domain/money';
import { effectivePricePerSession, type CatalogItem, type Therapist, type UUID, type VisitItem } from '@/domain/types';
import { SearchableSelect } from '@/components/SearchableSelect';
import { IconClose, IconUserPlus } from '@/components/StatIcons';

/** A package the patient has started and not finished — what a continuation row draws on. */
export interface OpenPackage {
  packageGroupId: UUID;
  serviceCatalogId: UUID;
  serviceName: string;
  logged: number;
  packageTotal: number;
  startedOn: string;
  /** The share the package's most recent session that had one gave a colleague; the next session starts with it. */
  lastShare?: { therapistId: UUID; pct: number } | null;
}

/**
 * One service row on the New Visit form (and the visit editor). Either a catalog service or, with
 * `continuation`, the next ₹0 session of an open package. `assistingTherapistId` null = the visit's
 * therapist does it.
 */
export interface DraftLine {
  key: string;
  serviceCatalogId?: UUID;
  continuation?: OpenPackage;
  assistingTherapistId: UUID | null;
  /** A colleague who helped with this service and the % of it they get (of the session's package share on a package row). */
  sessionShare?: { therapistId: UUID; pct: number } | null;
  /** The share was copied from the package's last session, not typed: the row says so until it is edited. */
  sharePrefilled?: boolean;
}

let keyCounter = 0;
/** A fresh React key for a new row. */
export function newDraftKey(): string {
  keyCounter += 1;
  return `row-${keyCounter}`;
}

export function emptyDraftLine(): DraftLine {
  return { key: newDraftKey(), assistingTherapistId: null };
}

export function continuationLine(pkg: OpenPackage, assistingTherapistId: UUID | null = null): DraftLine {
  const line: DraftLine = { key: newDraftKey(), continuation: pkg, assistingTherapistId };
  // A package helped over several sessions: this session starts with the last one's share (editable).
  if (pkg.lastShare && pkg.lastShare.therapistId !== assistingTherapistId) {
    line.sessionShare = pkg.lastShare;
    line.sharePrefilled = true;
  }
  return line;
}

/** A row that has a service (or package session) chosen. */
export function hasService(row: DraftLine): boolean {
  return Boolean(row.continuation || row.serviceCatalogId);
}

function catalogOf(row: DraftLine, catalog: CatalogItem[]): CatalogItem | undefined {
  const id = row.continuation?.serviceCatalogId ?? row.serviceCatalogId;
  return catalog.find((c) => c.id === id);
}

export function rowName(row: DraftLine, catalog: CatalogItem[]): string {
  return row.continuation?.serviceName ?? catalogOf(row, catalog)?.name ?? 'Service';
}

/** What the row adds to the subtotal: ₹0 for a package session billed earlier. */
export function rowPricePaise(row: DraftLine, catalog: CatalogItem[]): number {
  if (row.continuation) return 0;
  return catalogOf(row, catalog)?.basePricePaise ?? 0;
}

/** Sum of the rows' catalog prices — the visit-level adjustment applies to this. */
export function draftSubtotalPaise(rows: DraftLine[], catalog: CatalogItem[]): number {
  return rows.reduce((sum, r) => sum + rowPricePaise(r, catalog), 0);
}

/** The package-ness rule the visit service applies: a continuation, or a service with several sessions. */
export function isPackageRow(row: DraftLine, catalog: CatalogItem[]): boolean {
  return Boolean(row.continuation) || (catalogOf(row, catalog)?.sessionCount ?? 1) > 1;
}

/** Problems a row has on its own account, by row index — checked live and again on Save. */
export function rowProblems(rows: DraftLine[], catalog: CatalogItem[]): Map<number, string> {
  const out = new Map<number, string>();
  let seenPackage = false;
  rows.forEach((r, i) => {
    if (!hasService(r)) return;
    if (isPackageRow(r, catalog)) {
      if (seenPackage) {
        out.set(i, `${rowName(r, catalog)}: only one package per visit.`);
        return;
      }
      seenPackage = true;
    }
    if (r.sessionShare && (!Number.isInteger(r.sessionShare.pct) || r.sessionShare.pct < 1 || r.sessionShare.pct > 99)) {
      out.set(i, Number.isNaN(r.sessionShare.pct) ? 'Enter the % to share.' : 'A share must be a whole number from 1 to 99%.');
    }
  });
  return out;
}

/** The rows as visit lines, so the credit math (`autoCredits`) can run before anything is saved. */
export function draftLinesToItems(rows: DraftLine[], catalog: CatalogItem[]): VisitItem[] {
  const items: VisitItem[] = [];
  rows.forEach((r, position) => {
    const cat = catalogOf(r, catalog);
    if (!cat) return;
    items.push({
      id: r.key,
      clinicId: cat.clinicId,
      visitId: 'draft',
      position,
      serviceCatalogId: cat.id,
      serviceName: cat.name,
      catalogPricePaise: cat.basePricePaise,
      pricePaise: rowPricePaise(r, catalog),
      assistingTherapistId: r.assistingTherapistId,
      ...(r.sessionShare
        ? { sessionShareTherapistId: r.sessionShare.therapistId, sessionSharePct: r.sessionShare.pct }
        : {}),
      durationMinutes: cat.durationMinutes ?? null,
      isPackageLine: isPackageRow(r, catalog),
      deleted: false,
      updatedAt: '',
    });
  });
  return items;
}

const linkBtn = 'text-xs font-medium text-[var(--teal)] hover:underline';

const warnBtn =
  'inline-flex min-h-10 items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 text-sm font-medium text-[var(--ink)] hover:border-[var(--teal)] sm:min-h-8 sm:text-xs';
const warnBtnPrimary =
  'inline-flex min-h-10 items-center rounded-full border border-[var(--teal)] bg-[var(--teal)] px-3.5 text-sm font-medium text-white hover:opacity-90 sm:min-h-8 sm:text-xs';

/**
 * The open package a purchase row would double up on: the row buys a package service (more than one session,
 * not a continuation) and the patient still has a session open on that same service.
 */
export function openSamePackage(row: DraftLine, cat: CatalogItem | undefined, openPackages: OpenPackage[]): OpenPackage | undefined {
  if (row.continuation || !cat || cat.sessionCount <= 1) return undefined;
  return openPackages.find((p) => p.serviceCatalogId === cat.id);
}

/** Focuses the picker's input when it mounts, so "Add another service" / "Change" land ready to type. */
function FocusedPicker({
  autoFocus,
  ...props
}: { autoFocus: boolean } & React.ComponentProps<typeof SearchableSelect>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.querySelector('input')?.focus();
  }, [autoFocus]);
  return (
    <div ref={ref}>
      <SearchableSelect {...props} />
    </div>
  );
}

export interface ServiceRowsProps {
  rows: DraftLine[];
  onChange: (rows: DraftLine[]) => void;
  catalog: CatalogItem[];
  openPackages: OpenPackage[];
  therapists: Therapist[];
  /** The visit's therapist — who does a row unless "Done by" says otherwise. */
  primaryId: UUID;
  /** False for a solo clinic: no "Done by" / "Share". */
  showAssistant: boolean;
  /** Messages the page wants on specific rows (by index), shown in addition to the package rule. */
  errors: Map<number, string>;
  patientName?: string;
  quickServices?: CatalogItem[];
}

/**
 * The service rows: each a small card with the service, its price and an optional assisting therapist.
 * Presentational — rows in, changes out — so the visit editor can reuse it.
 */
export function ServiceRows({
  rows,
  onChange,
  catalog,
  openPackages,
  therapists,
  primaryId,
  showAssistant,
  errors,
  patientName,
  quickServices,
}: ServiceRowsProps) {
  // Which row's service picker is open for a change, which row's assistant picker, and which to focus.
  const [changing, setChanging] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // Rows where staff confirmed "yes, a new package" while the same one still has a session open.
  const [newPackageOk, setNewPackageOk] = useState<ReadonlySet<string>>(new Set());

  const problems = useMemo(() => rowProblems(rows, catalog), [rows, catalog]);
  // Everyone who can do a service: the visit's therapist and the other active therapists.
  const doers = useMemo(
    () => therapists.filter((t) => t.active || t.id === primaryId),
    [therapists, primaryId]
  );

  const serviceOptions = useMemo(() => {
    const packages = openPackages.map((p) => ({
      value: `pkg:${p.packageGroupId}`,
      label: `Continue: ${p.serviceName} — session ${p.logged + 1} of ${p.packageTotal} (₹0)`,
      group: 'Open packages',
    }));
    const services = catalog.map((i) => ({
      value: `svc:${i.id}`,
      label: `${i.name} — ${formatINR(i.basePricePaise)}${
        i.sessionCount > 1
          ? ` (${i.sessionCount} sessions, ${formatINR(effectivePricePerSession(i))}/session)`
          : ''
      }`,
      group: i.category,
    }));
    return [...packages, ...services];
  }, [openPackages, catalog]);

  function update(key: string, patch: Partial<DraftLine>) {
    onChange(
      rows.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // Typing a share (or removing it) makes it the user's own: it is no longer "same as last session".
        if ('sessionShare' in patch && !('sharePrefilled' in patch)) next.sharePrefilled = false;
        // A service can't be shared with the therapist who does it.
        const runner = next.assistingTherapistId ?? primaryId;
        if (next.sessionShare && next.sessionShare.therapistId === runner) {
          next.sessionShare = null;
        }
        return next;
      })
    );
  }

  // A change of the visit's therapist can make the shared therapist the one who does the row: drop that share.
  useEffect(() => {
    if (rows.some((r) => r.sessionShare && r.sessionShare.therapistId === (r.assistingTherapistId ?? primaryId))) {
      onChange(
        rows.map((r) =>
          r.sessionShare && r.sessionShare.therapistId === (r.assistingTherapistId ?? primaryId)
            ? { ...r, sessionShare: null }
            : r
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryId, rows]);

  function pick(key: string, value: string) {
    if (value.startsWith('pkg:')) {
      const pkg = openPackages.find((p) => p.packageGroupId === value.slice(4));
      if (pkg) {
        const inherit = pkg.lastShare && pkg.lastShare.therapistId !== primaryId;
        update(key, {
          continuation: pkg,
          serviceCatalogId: undefined,
          ...(inherit ? { sessionShare: pkg.lastShare, sharePrefilled: true } : {}),
        });
      }
    } else {
      update(key, { serviceCatalogId: value.slice(4), continuation: undefined });
    }
    setChanging(null);
    setFocusKey(null);
  }

  function addRow() {
    const row = emptyDraftLine();
    setFocusKey(row.key);
    onChange([...rows, row]);
  }

  function switchToOtherService(key: string) {
    setFocusKey(key);
    update(key, { continuation: undefined, serviceCatalogId: undefined });
  }

  const hasPackageRow = rows.some((r) => r.continuation);
  const warnedInRow = rows.some((r) => openSamePackage(r, catalogOf(r, catalog), openPackages));
  const showGuardrail = openPackages.length > 0 && !hasPackageRow && !(openPackages.length === 1 && warnedInRow);
  const who = patientName ?? 'This patient';

  const availableQuickServices = useMemo(() => {
    return (quickServices ?? []).filter(
      (s) =>
        s.active &&
        // A shortcut is for the everyday paid service: not a free session, and not a second purchase of a package that is still open.
        s.basePricePaise > 0 &&
        !(s.sessionCount > 1 && openPackages.some((p) => p.serviceCatalogId === s.id)) &&
        !rows.some((r) => r.serviceCatalogId === s.id)
    );
  }, [quickServices, rows, openPackages]);

  function pickQuickService(service: CatalogItem) {
    const emptyAt = rows.findIndex((r) => !hasService(r));
    const targetKey = emptyAt >= 0 ? rows[emptyAt].key : newDraftKey();
    const newLine: DraftLine = {
      key: targetKey,
      serviceCatalogId: service.id,
      assistingTherapistId: emptyAt >= 0 ? rows[emptyAt].assistingTherapistId : null,
    };
    if (emptyAt >= 0) {
      onChange(rows.map((r, i) => (i === emptyAt ? newLine : r)));
    } else {
      onChange([...rows, newLine]);
    }
  }

  return (
    <div className="space-y-2">
      {rows.map((row, index) => {
        const named = hasService(row);
        const picking = !named || changing === row.key;
        const error = errors.get(index) ?? problems.get(index);
        const name = rowName(row, catalog);
        const cat = catalogOf(row, catalog);
        const openSame = openSamePackage(row, cat, openPackages);
        return (
          <div
            key={row.key}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              // Inside a dialog (Edit visit) Escape closes the open picker only, not the whole dialog.
              if (changing === row.key || !named) e.stopPropagation();
              setChanging(null);
            }}
            // A chosen service is a card; an empty row is just the search box (its own border), not a box inside a box.
            className={
              named
                ? `rounded-lg border bg-[var(--surface)] p-3 ${error ? 'border-[var(--rust)]' : 'border-[var(--border)]'}`
                : ''
            }
          >
            {picking ? (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <FocusedPicker
                    autoFocus={focusKey === row.key}
                    label="Service"
                    value={row.continuation ? `pkg:${row.continuation.packageGroupId}` : row.serviceCatalogId ? `svc:${row.serviceCatalogId}` : ''}
                    onChange={(v) => pick(row.key, v)}
                    options={serviceOptions}
                  />
                </div>
                {rows.length > 1 && (
                  <RemoveButton name={named ? name : 'service'} onClick={() => onChange(rows.filter((r) => r.key !== row.key))} />
                )}
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left text-sm font-medium text-[var(--ink)] hover:text-[var(--teal)]"
                  title="Change service"
                  onClick={() => {
                    setChanging(row.key);
                    setFocusKey(row.key);
                  }}
                >
                  {name}
                </button>
                <span className="font-num shrink-0 text-sm text-[var(--ink)]">
                  {formatINR(rowPricePaise(row, catalog))}
                </span>
                {rows.length > 1 && (
                  <RemoveButton name={name} onClick={() => onChange(rows.filter((r) => r.key !== row.key))} />
                )}
              </div>
            )}

            {named && row.continuation && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                <span>
                  Session {row.continuation.logged + 1} of {row.continuation.packageTotal} · package (₹0)
                </span>
                <button type="button" className={linkBtn} onClick={() => switchToOtherService(row.key)}>
                  Use a different service
                </button>
              </div>
            )}
            {named && !row.continuation && cat && cat.sessionCount > 1 && (
              <div className="mt-0.5 text-xs text-[var(--muted)]">{cat.sessionCount}-session package</div>
            )}
            {openSame && !newPackageOk.has(row.key) && (
              // The money guard: this row sells a NEW package while one of the same service still has a session left.
              <div role="alert" className="mt-2.5 rounded-md border border-[var(--amber)] bg-[var(--amber-light)] px-3 py-2.5 text-sm text-[var(--ink)]">
                <p>
                  {who} still has session {openSame.logged + 1} of {openSame.packageTotal} on this package. This row charges{' '}
                  <strong className="font-num">{formatINR(rowPricePaise(row, catalog))}</strong> for a <strong>new</strong> one.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={`${warnBtnPrimary}`} onClick={() => pick(row.key, `pkg:${openSame.packageGroupId}`)}>
                    Use the remaining session (₹0)
                  </button>
                  <button type="button" className={warnBtn} onClick={() => setNewPackageOk((prev) => new Set(prev).add(row.key))}>
                    Yes, a new package
                  </button>
                </div>
              </div>
            )}
            {openSame && newPackageOk.has(row.key) && (
              <p className="mt-1 text-xs text-[var(--muted)]">New package, separate from the open one.</p>
            )}

            {named && showAssistant && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2.5">
                {doers.length > 1 && (
                  // A native select dressed as the pill: one tap, same look open or closed.
                  <label
                    className={`${pillBtn} relative cursor-pointer ${
                      row.assistingTherapistId ? '!border-[var(--teal)] !text-[var(--teal)]' : ''
                    }`}
                    title="Who did this service. They get its money."
                  >
                    <IconUserPlus className="h-3.5 w-3.5" />
                    <span>Done by:</span>
                    <select
                      aria-label="Done by"
                      className="max-w-[10rem] cursor-pointer appearance-none truncate bg-transparent pr-3 text-base font-medium text-inherit focus:outline-none sm:text-xs"
                      value={row.assistingTherapistId ?? primaryId}
                      onChange={(e) => update(row.key, { assistingTherapistId: e.target.value === primaryId ? null : e.target.value })}
                    >
                      {doers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <span aria-hidden="true" className="pointer-events-none absolute right-2.5 text-[10px]">▾</span>
                  </label>
                )}
                <RowShare
                  row={row}
                  pricePaise={rowPricePaise(row, catalog)}
                  isPackage={isPackageRow(row, catalog)}
                  candidates={therapists.filter((t) => t.active && t.id !== (row.assistingTherapistId ?? primaryId))}
                  onChange={(sessionShare) => update(row.key, { sessionShare })}
                />
              </div>
            )}

            {error && <p className="mt-1.5 text-xs text-[var(--rust)]">{error}</p>}
          </div>
        );
      })}

      {availableQuickServices.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 pb-0.5" data-testid="quick-services">
          <span className="text-xs text-[var(--muted)]">Quick add:</span>
          {availableQuickServices.map((s) => (
            <button
              key={s.id}
              type="button"
              className="inline-flex min-h-10 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--teal)] hover:bg-[var(--paper)] hover:text-[var(--teal)] sm:min-h-8 sm:px-2.5 sm:text-xs"
              onClick={() => pickQuickService(s)}
            >
              + {s.name}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-sm font-medium text-[var(--teal)] hover:border-[var(--teal)] hover:bg-[var(--paper)]"
        onClick={addRow}
      >
        + Add another service
      </button>

      {showGuardrail && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-[var(--amber)]/50 bg-[var(--amber-light)] px-3 py-2.5 text-sm text-[var(--ink)]">
          {openPackages.length === 1 ? (
            <>
              <span>
                {who} has an open package (session {openPackages[0].logged + 1} of {openPackages[0].packageTotal}).
                It isn&apos;t used on this visit.
              </span>
              <button
                type="button"
                className={warnBtnPrimary}
                onClick={() => {
                  const pkgLine = continuationLine(openPackages[0]);
                  // Fill an empty row if there is one; otherwise add the session as its own row.
                  const emptyAt = rows.findIndex((r) => !hasService(r));
                  if (emptyAt >= 0) {
                    onChange(rows.map((r, i) => (i === emptyAt ? { ...pkgLine, key: r.key, assistingTherapistId: r.assistingTherapistId } : r)));
                  } else {
                    onChange([...rows, pkgLine]);
                  }
                }}
              >
                Add package session
              </button>
            </>
          ) : (
            <div className="w-full space-y-1.5">
              <span>{who} has {openPackages.length} open packages. Tap to continue:</span>
              <div className="flex flex-wrap gap-1.5" data-testid="package-chips">
                {openPackages.map((pkg) => {
                  const alreadyUsed = rows.some((r) => r.continuation?.packageGroupId === pkg.packageGroupId);
                  if (alreadyUsed) return null;
                  return (
                    <button
                      key={pkg.packageGroupId}
                      type="button"
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--ink)] hover:border-[var(--teal)] hover:bg-[var(--paper)]"
                      onClick={() => {
                        const pkgLine = continuationLine(pkg);
                        const emptyAt = rows.findIndex((r) => !hasService(r));
                        if (emptyAt >= 0) {
                          onChange(rows.map((r, i) => (i === emptyAt ? { ...pkgLine, key: r.key, assistingTherapistId: r.assistingTherapistId } : r)));
                        } else {
                          onChange([...rows, pkgLine]);
                        }
                      }}
                    >
                      <span className="font-medium">{pkg.serviceName}</span>
                      <span className="text-[var(--muted)]">({pkg.logged + 1} of {pkg.packageTotal})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "Share": a colleague who helped gets a percentage of this service; whoever does it keeps the rest. On a
 * paid service the money moves through the visit's revenue shares, on a package session through package
 * attribution — the row just records who and how much.
 */
function RowShare({
  row,
  pricePaise,
  isPackage,
  candidates,
  onChange,
}: {
  row: DraftLine;
  pricePaise: number;
  isPackage: boolean;
  candidates: Therapist[];
  onChange: (share: DraftLine['sessionShare']) => void;
}) {
  const share = row.sessionShare;
  if (!share) {
    if (candidates.length === 0) return null;
    return (
      <button
        type="button"
        className={pillBtn}
        title="Give a colleague who helped a % of this service"
        onClick={() => onChange({ therapistId: candidates[0]!.id, pct: NaN })}
      >
        Share
      </button>
    );
  }
  const preview =
    !isPackage && Number.isFinite(share.pct) && share.pct > 0 && pricePaise > 0
      ? formatINR(roundToRupeeHalfUp((pricePaise * share.pct) / 100))
      : null;
  return (
    // Phone: the label on its own line, then dropdown + % + remove on ONE line, then the plain-language result.
    // sm+: label and controls share a line. Controls are 16px on touch (no iOS zoom), 14px with a mouse.
    <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="w-full text-sm font-medium text-[var(--ink)] sm:w-auto sm:font-normal sm:text-[var(--muted)]">Shared with</span>
      <select
        aria-label="Shared with"
        className="min-h-10 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-base text-[var(--ink)] sm:min-h-8 sm:flex-none sm:text-sm"
        value={share.therapistId}
        onChange={(e) => onChange({ ...share, therapistId: e.target.value })}
      >
        {candidates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <div className="relative shrink-0">
        <input
          type="number"
          min={1}
          max={99}
          inputMode="numeric"
          aria-label="Percent of this service"
          className="min-h-10 w-20 rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 pl-2 pr-6 text-right text-base text-[var(--ink)] sm:min-h-8 sm:w-16 sm:text-sm"
          placeholder="0"
          autoFocus={!Number.isFinite(share.pct)}
          value={Number.isFinite(share.pct) ? share.pct : ''}
          onChange={(e) => onChange({ ...share, pct: e.target.value === '' ? NaN : Number(e.target.value) })}
        />
        <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-[var(--muted)]">%</span>
      </div>
      <button
        type="button"
        aria-label="Remove share"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--rust)] sm:h-8 sm:w-8"
        onClick={() => onChange(null)}
      >
        <IconClose className="h-3.5 w-3.5" />
      </button>
      <p className="w-full text-xs text-[var(--muted)]">
        Their share of this {isPackage ? 'session' : 'service'}
        {preview && (
          <>
            {' · '}
            <span className="font-num text-[var(--ink)]">≈ {preview}</span>
          </>
        )}
        {row.sharePrefilled && ' · Same as last session'}
      </p>
    </div>
  );
}

/** Small outlined action pill under a service (Assistant, Share session). */
const pillBtn =
  'inline-flex min-h-10 sm:min-h-8 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--muted)] hover:border-[var(--teal)] hover:text-[var(--teal)] sm:text-xs';

function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${name}`}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--rust)] sm:h-7 sm:w-7"
      onClick={onClick}
    >
      <IconClose className="h-4 w-4" />
    </button>
  );
}
