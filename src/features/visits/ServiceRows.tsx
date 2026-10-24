import { useEffect, useMemo, useRef, useState } from 'react';
import { formatINR } from '@/domain/money';
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
  /** Package rows only: a colleague who helped with this session and the % of the session's package share they get. */
  sessionShare?: { therapistId: UUID; pct: number } | null;
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
  return { key: newDraftKey(), continuation: pkg, assistingTherapistId };
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
    if (!isPackageRow(r, catalog)) return;
    if (seenPackage) out.set(i, `${rowName(r, catalog)}: only one package per visit.`);
    else if (r.sessionShare && (!Number.isInteger(r.sessionShare.pct) || r.sessionShare.pct < 1 || r.sessionShare.pct > 99)) {
      out.set(i, 'A session share must be a whole number from 1 to 99%.');
    }
    seenPackage = true;
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
      durationMinutes: cat.durationMinutes ?? null,
      isPackageLine: isPackageRow(r, catalog),
      deleted: false,
      updatedAt: '',
    });
  });
  return items;
}

const linkBtn = 'text-xs font-medium text-[var(--teal)] hover:underline';

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
  /** The visit's therapist — never offered as an assistant. */
  primaryId: UUID;
  /** False for a solo clinic: no "Assign assistant". */
  showAssistant: boolean;
  /** Messages the page wants on specific rows (by index), shown in addition to the package rule. */
  errors: Map<number, string>;
  patientName?: string;
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
}: ServiceRowsProps) {
  // Which row's service picker is open for a change, which row's assistant picker, and which to focus.
  const [changing, setChanging] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const problems = useMemo(() => rowProblems(rows, catalog), [rows, catalog]);
  const assistants = useMemo(
    () => therapists.filter((t) => t.active && t.id !== primaryId),
    [therapists, primaryId]
  );
  const therapistName = (id: UUID) => therapists.find((t) => t.id === id)?.name ?? 'Assistant';

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
        // The helper of a session can't also be the one who runs it; a non-package row has no session to share.
        const runner = next.assistingTherapistId ?? primaryId;
        if (next.sessionShare && (next.sessionShare.therapistId === runner || !isPackageRow(next, catalog))) {
          next.sessionShare = null;
        }
        return next;
      })
    );
  }

  // A change of the visit's therapist can make a row's helper the runner: drop that share.
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
      if (pkg) update(key, { continuation: pkg, serviceCatalogId: undefined });
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
  const showGuardrail = openPackages.length > 0 && !hasPackageRow;
  const who = patientName ?? 'This patient';

  return (
    <div className="space-y-2">
      {rows.map((row, index) => {
        const named = hasService(row);
        const picking = !named || changing === row.key;
        const error = errors.get(index) ?? problems.get(index);
        const name = rowName(row, catalog);
        const cat = catalogOf(row, catalog);
        return (
          <div
            key={row.key}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              setChanging(null);
              setAssigning(null);
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
              <div className="mt-1 text-xs text-[var(--muted)]">{cat.sessionCount}-session package</div>
            )}

            {named && (
              <div className="mt-1.5">
                {row.assistingTherapistId ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--teal-light)] px-2.5 py-0.5 text-xs text-[var(--teal)]">
                    {therapistName(row.assistingTherapistId)} · assisting
                    <button
                      type="button"
                      aria-label={`Remove assistant ${therapistName(row.assistingTherapistId)}`}
                      className="rounded-full p-0.5 hover:bg-[var(--surface)]"
                      onClick={() => update(row.key, { assistingTherapistId: null })}
                    >
                      <IconClose className="h-3 w-3" />
                    </button>
                  </span>
                ) : showAssistant && assistants.length > 0 ? (
                  assigning === row.key ? (
                    <FocusedPicker
                      autoFocus
                      label="Assistant"
                      value=""
                      onChange={(v) => {
                        update(row.key, { assistingTherapistId: v });
                        setAssigning(null);
                      }}
                      options={assistants.map((t) => ({ value: t.id, label: t.name }))}
                    />
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--teal)]"
                      onClick={() => setAssigning(row.key)}
                    >
                      <IconUserPlus className="h-3.5 w-3.5" />
                      + Assign assistant
                    </button>
                  )
                ) : null}
              </div>
            )}

            {named && showAssistant && isPackageRow(row, catalog) && (
              <SessionShare
                row={row}
                candidates={therapists.filter((t) => t.active && t.id !== (row.assistingTherapistId ?? primaryId))}
                onChange={(sessionShare) => update(row.key, { sessionShare })}
              />
            )}

            {error && <p className="mt-1.5 text-xs text-[var(--rust)]">{error}</p>}
          </div>
        );
      })}

      <button type="button" className={linkBtn} onClick={addRow}>
        + Add another service
      </button>

      {showGuardrail && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-[var(--paper)] px-3 py-2 text-xs text-[var(--muted)]">
          {openPackages.length === 1 ? (
            <>
              <span>
                {who} has an open package (session {openPackages[0].logged + 1} of {openPackages[0].packageTotal}).
                It isn&apos;t used on this visit.
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
                Add package session
              </button>
            </>
          ) : (
            <span>
              {who} has {openPackages.length} open packages. None is used on this visit; pick one from the
              service list to continue it.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** "Share this session": a colleague who helped gets a percentage of the session's package share. */
function SessionShare({
  row,
  candidates,
  onChange,
}: {
  row: DraftLine;
  candidates: Therapist[];
  onChange: (share: DraftLine['sessionShare']) => void;
}) {
  const share = row.sessionShare;
  if (!share) {
    if (candidates.length === 0) return null;
    return (
      <button
        type="button"
        className="mt-1 text-xs text-[var(--muted)] hover:text-[var(--teal)]"
        title="Give a colleague who helped part of this session's package share"
        onClick={() => onChange({ therapistId: candidates[0]!.id, pct: 50 })}
      >
        + Share this session
      </button>
    );
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
      <span>Shared with</span>
      <select
        aria-label="Colleague who helped"
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--ink)]"
        value={share.therapistId}
        onChange={(e) => onChange({ ...share, therapistId: e.target.value })}
      >
        {candidates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1">
        <input
          type="number"
          min={1}
          max={99}
          inputMode="numeric"
          aria-label="Percent of this session"
          className="w-14 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-right text-xs text-[var(--ink)]"
          value={Number.isFinite(share.pct) ? share.pct : ''}
          onChange={(e) => onChange({ ...share, pct: e.target.value === '' ? NaN : Number(e.target.value) })}
        />
        % of this session
      </label>
      <button
        type="button"
        aria-label="Remove session share"
        className="rounded p-0.5 hover:bg-[var(--paper)]"
        onClick={() => onChange(null)}
      >
        <IconClose className="h-3 w-3" />
      </button>
    </div>
  );
}

function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${name}`}
      className="shrink-0 rounded p-1 text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--rust)]"
      onClick={onClick}
    >
      <IconClose className="h-4 w-4" />
    </button>
  );
}
