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


/** "1 session" / "3 sessions" still to use on an open package. */
function sessionsLeft(pkg: OpenPackage): string {
  const left = Math.max(0, pkg.packageTotal - pkg.logged);
  return `${left} session${left === 1 ? '' : 's'}`;
}

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
  /** True after a Save attempt: show every row problem, including a share whose % was never typed. */
  revealProblems?: boolean;
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
  revealProblems = false,
}: ServiceRowsProps) {
  // Which row's service picker is open for a change, which row's assistant picker, and which to focus.
  const [changing, setChanging] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // Rows where staff confirmed "yes, a new package" while the same one still has a session open.
  const [newPackageOk, setNewPackageOk] = useState<ReadonlySet<string>>(new Set());
  // Shares whose % box has been left at least once: only then is an empty % worth a red message.
  const [shareBlurred, setShareBlurred] = useState<ReadonlySet<string>>(new Set());

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
        // A share just added has no % yet: that is the next thing to type, not an error, until the box is left or Save is pressed.
        const freshShare =
          !revealProblems && row.sessionShare !== null && row.sessionShare !== undefined && Number.isNaN(row.sessionShare.pct) && !shareBlurred.has(row.key);
        const error = errors.get(index) ?? (freshShare ? undefined : problems.get(index));
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
                <span className="shrink-0 text-sm font-medium tabular-nums text-[var(--ink)]">
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
              // The money guard, kept to one quiet line: this row sells a NEW package while the same one still has a session left.
              <p role="alert" className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-[var(--amber)]">
                <span>
                  {who} still has {sessionsLeft(openSame)} left on this package. This row starts a new one.
                </span>
                <button type="button" className={linkBtn} onClick={() => pick(row.key, `pkg:${openSame.packageGroupId}`)}>
                  Use remaining session
                </button>
                <button type="button" className={linkBtn} onClick={() => setNewPackageOk((prev) => new Set(prev).add(row.key))}>
                  Keep new package
                </button>
              </p>
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
                    <span className="max-w-[10rem] truncate pr-3 text-[var(--ink)]">
                      {doers.find((t) => t.id === (row.assistingTherapistId ?? primaryId))?.name ?? 'Choose'}
                    </span>
                    {/* The real select sits invisibly over the pill: it opens the native list, and its 16px text
                        stops iOS zooming on tap, while what you see stays the page's 12px. */}
                    <select
                      aria-label="Done by"
                      className="absolute inset-0 cursor-pointer appearance-none opacity-0 text-base"
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
                  onPctBlur={() => setShareBlurred((prev) => new Set(prev).add(row.key))}
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
              className={chip}
              onClick={() => pickQuickService(s)}
            >
              + {s.name}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className="flex h-9 w-full items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-xs font-medium text-[var(--teal)] hover:border-[var(--teal)] hover:bg-[var(--paper)]"
        onClick={addRow}
      >
        + Add another service
      </button>

      {showGuardrail && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-[var(--paper)] px-3 py-2 text-xs text-[var(--muted)]">
          {openPackages.length === 1 ? (
            <>
              <span>
                <span className="font-medium text-[var(--ink)]">Open package:</span> {openPackages[0].serviceName} —{' '}
                {sessionsLeft(openPackages[0])} left ({openPackages[0].logged} of {openPackages[0].packageTotal} used).
              </span>
              <button
                type="button"
                className={linkBtn}
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
                Use a session for this visit (₹0)
              </button>
            </>
          ) : (
            <div className="w-full space-y-1.5">
              <span>
                <span className="font-medium text-[var(--ink)]">Open packages:</span> {who} has {openPackages.length}. Use one for this visit (₹0):
              </span>
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
                      <span className="text-[var(--muted)]">· {sessionsLeft(pkg)} left</span>
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
  onPctBlur,
}: {
  row: DraftLine;
  pricePaise: number;
  isPackage: boolean;
  candidates: Therapist[];
  onChange: (share: DraftLine['sessionShare']) => void;
  onPctBlur?: () => void;
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
      <span className="w-full text-xs text-[var(--muted)] sm:w-auto">Shared with</span>
      <div className="relative flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--ink)] sm:min-w-[8rem] sm:flex-none">
        <span className="truncate">{candidates.find((t) => t.id === share.therapistId)?.name ?? 'Choose'}</span>
        <span aria-hidden="true" className="text-[10px] text-[var(--muted)]">▾</span>
        {/* Invisible native select on top: the native list, no iOS zoom, 12px on screen. */}
        <select
          aria-label="Shared with"
          className="absolute inset-0 cursor-pointer appearance-none opacity-0 text-base"
          value={share.therapistId}
          onChange={(e) => onChange({ ...share, therapistId: e.target.value })}
        >
          {candidates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="relative shrink-0">
        <input
          type="number"
          min={1}
          max={99}
          inputMode="numeric"
          aria-label="Percent of this service"
          className="h-8 w-16 rounded-md border border-[var(--border)] bg-[var(--surface)] py-0 pl-2 pr-6 text-right text-base text-[var(--ink)] [appearance:textfield] sm:text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          autoFocus={!Number.isFinite(share.pct)}
          onBlur={onPctBlur}
          value={Number.isFinite(share.pct) ? share.pct : ''}
          onChange={(e) => onChange({ ...share, pct: e.target.value === '' ? NaN : Number(e.target.value) })}
        />
        <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">%</span>
      </div>
      <button
        type="button"
        aria-label="Remove share"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--rust)]"
        onClick={() => onChange(null)}
      >
        <IconClose className="h-3.5 w-3.5" />
      </button>
      <p className="w-full text-xs text-[var(--muted)]">
        Their share of this {isPackage ? 'session' : 'service'}
        {preview && (
          <>
            {' · '}
            <span className="tabular-nums text-[var(--ink)]">≈ {preview}</span>
          </>
        )}
        {row.sharePrefilled && ' · Same as last session'}
      </p>
    </div>
  );
}

/** Small outlined action pill under a service (Assistant, Share session). */
const pillBtn =
  'inline-flex h-8 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--muted)] hover:border-[var(--teal)] hover:text-[var(--teal)]';

/** The one chip on this page — same size and type as the treatment chips (32px, 12px). */
const chip =
  'inline-flex h-8 items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--ink)] transition-colors hover:border-[var(--teal)] hover:text-[var(--teal)]';

function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${name}`}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--rust)]"
      onClick={onClick}
    >
      <IconClose className="h-4 w-4" />
    </button>
  );
}
