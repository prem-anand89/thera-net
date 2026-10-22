import type { InvoiceLineItem, UUID, Visit, VisitItem } from './types';
import type { Paise } from './money';
import { lineNets } from './visitLines';

/**
 * `packageTotal: 0` is storable today (the CSV importer can write it) and is
 * NOT "no package" — only null/undefined/absent means that. Never collapse
 * this with a bare `?? null`: that lets `0` survive as a divisor downstream
 * and produce `Infinity` written into an immutable invoice snapshot. Every
 * place that reads `packageTotal`/`authorizedSessionCount` toward an
 * "authorized session count" meaning goes through this one function.
 */
export function normalizeAuthorizedCount(packageTotal: number | null | undefined): number | null {
  return packageTotal && packageTotal > 0 ? packageTotal : null;
}

/** Presence check only — no heuristics. */
export function isV2Line(li: InvoiceLineItem): boolean {
  return li.lineItemVersion === 2;
}

/**
 * The rate a line was actually billed at, snapshotted — v2 lines carry it
 * directly; legacy lines derive it from the package total. `Math.max(1, …)`
 * floors the divisor so a corrupt/zero session count (or a legacy row from
 * before this floor existed) never divides toward `Infinity`.
 *
 * NEVER derive this from live catalog data (`effectivePricePerSession` in
 * `types.ts` reads current prices) — an issued invoice must only ever
 * re-derive from its own snapshot, never today's catalog.
 */
export function lineRatePerSessionPaise(li: InvoiceLineItem): Paise {
  if (isV2Line(li) && li.ratePerSessionPaise != null) return li.ratePerSessionPaise;
  return Math.round(li.catalogPricePaise / Math.max(1, li.sessionCount));
}

/**
 * "3 sessions" / "3 of 10 sessions" — generalized over both shapes, with a
 * legacy fallback. Clamps `billedSessionCount` to `authorizedSessionCount`
 * when both are present and billed would otherwise exceed it — not
 * reachable through the normal visit flow, but the CSV importer could
 * produce it, and it's cheap insurance against ever printing
 * "11 of 10 sessions".
 */
export function sessionCountLabel(li: InvoiceLineItem): string {
  if (!isV2Line(li)) {
    return `${li.sessionCount} session${li.sessionCount === 1 ? '' : 's'}`;
  }
  const authorized = normalizeAuthorizedCount(li.authorizedSessionCount ?? null);
  const billed = li.billedSessionCount ?? li.sessionCount;
  if (authorized == null) {
    return `${billed} session${billed === 1 ? '' : 's'}`;
  }
  const clampedBilled = Math.min(billed, authorized);
  if (clampedBilled === authorized) {
    return `${authorized} session${authorized === 1 ? '' : 's'}`;
  }
  return `${clampedBilled} of ${authorized} sessions`;
}

/** Above this many session dates, the print page condenses to a range
 *  rather than listing every date — see `sessionDatesDisplay` below. */
const SESSION_DATE_LIST_THRESHOLD = 8;

export type SessionDatesDisplay =
  { mode: 'list'; dates: string[] } | { mode: 'range'; from: string; to: string; count: number };

/**
 * How a line's session dates should render: every date, comma-separated,
 * for a short run; a "from – to (N sessions)" range once the list would get
 * unreadably long — a 20-30 session post-op package (TKR/THR rehab is the
 * common case) otherwise wraps a wall of dates into one table cell. Pure
 * data shape only — callers own date formatting (`formatDateDMY` etc.),
 * since this module has no display-formatting dependency of its own.
 */
export function sessionDatesDisplay(li: InvoiceLineItem): SessionDatesDisplay {
  const dates = li.sessionDates;
  if (dates.length <= SESSION_DATE_LIST_THRESHOLD) return { mode: 'list', dates };
  const sorted = [...dates].sort();
  return { mode: 'range', from: sorted[0], to: sorted[sorted.length - 1], count: dates.length };
}

export interface DatePeriod {
  from: string;
  to: string;
}

/** Earliest/latest of a line's own session dates, or null if it has none. */
export function linePeriod(li: InvoiceLineItem): DatePeriod | null {
  if (li.sessionDates.length === 0) return null;
  const sorted = [...li.sessionDates].sort();
  return { from: sorted[0], to: sorted[sorted.length - 1] };
}

/** Earliest/latest across every line on an invoice — feeds the print
 *  page's treatment-period line, works for both legacy and v2 shapes. */
export function invoicePeriod(lineItems: InvoiceLineItem[]): DatePeriod | null {
  const periods = lineItems.map(linePeriod).filter((p): p is DatePeriod => p !== null);
  if (periods.length === 0) return null;
  const from = periods.map((p) => p.from).sort()[0];
  const to = periods.map((p) => p.to).sort()[periods.length - 1];
  return { from, to };
}

/**
 * Whether a line's own printed numbers multiply out exactly:
 * `billedSessionCount * ratePerSessionPaise + adjustmentPaise === totalPaise`.
 * v2 lines only — a legacy line has no snapshotted rate to check against,
 * so it's always treated as non-reconciling (nothing to verify, and the
 * print page falls back to its legacy renderer for those regardless).
 *
 * This is what D1's print caption keys off, in place of a proxy condition
 * ("delivered < authorized") that misses two real cases: a fully-billed
 * package whose price doesn't divide evenly by session count (rounding),
 * and — the reason for D1 in the first place — a genuine partial package.
 */
export function lineReconciles(li: InvoiceLineItem): boolean {
  if (!isV2Line(li)) return false;
  const billed = li.billedSessionCount ?? li.sessionCount;
  const rate = lineRatePerSessionPaise(li);
  return billed * rate + li.adjustmentPaise === li.totalPaise;
}

/**
 * What an invoice line is built from: one service line of a visit with its net amount (the visit's
 * bill spread over its lines, `lineNets`), or — for a visit without live lines — the whole visit
 * (`item: null`, `netPaise` = the bill), which prints exactly as it always did.
 */
export interface BillingUnit {
  visit: Visit;
  item: VisitItem | null;
  netPaise: Paise;
}

/** Turns visits (and their lines, keyed by visit id) into billing units: one per live line. */
export function billingUnits(visits: Visit[], itemsByVisitId: Map<UUID, VisitItem[]>): BillingUnit[] {
  const units: BillingUnit[] = [];
  for (const visit of visits) {
    const live = (itemsByVisitId.get(visit.id) ?? []).filter((i) => !i.deleted);
    if (live.length === 0) {
      units.push({ visit, item: null, netPaise: visit.actualBillPaise });
      continue;
    }
    const nets = lineNets(live, visit.actualBillPaise);
    for (const item of live) {
      const net = nets.get(item.id);
      if (net === undefined) throw new Error('A service line has no amount; cannot print the invoice.');
      units.push({ visit, item, netPaise: net });
    }
  }
  return units;
}

function asUnit(x: Visit | BillingUnit): BillingUnit {
  return 'visit' in x ? x : { visit: x, item: null, netPaise: x.actualBillPaise };
}

/**
 * Groups visits into invoice line items. `packageGroupId` still wins when
 * present; otherwise visits fall back to a `svc:` key namespaced by service
 * + price, so several independently-logged (non-package) visits of the
 * same service at the same price collapse into one "bill by service" line
 * — the `svc:` prefix keeps this key space disjoint from `packageGroupId`
 * (both UUIDs) so the two can never collide, and keying on price too means
 * visits priced differently (the catalog changed mid-course) never merge
 * into one line with one fabricated rate.
 */
export function invoiceLineGroupKey(
  v: Pick<Visit, 'packageGroupId' | 'serviceCatalogId' | 'catalogPricePaise'>
): string {
  return v.packageGroupId ?? `svc:${v.serviceCatalogId}:${v.catalogPricePaise}`;
}

/** A unit's group key: the package group only for the PACKAGE line; any other line of a package
 *  visit (an add-on) groups by its own service + catalog price like any other service. */
export function unitGroupKey(u: BillingUnit): string {
  if (!u.item) return invoiceLineGroupKey(u.visit);
  if (u.item.isPackageLine && u.visit.packageGroupId) return u.visit.packageGroupId;
  return `svc:${u.item.serviceCatalogId}:${u.item.catalogPricePaise}`;
}

/**
 * Pure grouping over an already-resolved, already-package-expanded flat
 * list (the caller — `invoiceService.ts` — is responsible for fetching a
 * visit's full package siblings before calling this; that part needs
 * `repos`, so it can't live in this pure module). Takes billing units, or
 * plain visits (each a single line-less unit). Dedupes defensively, since the
 * same visit can appear twice when two selected visits belong to the same package.
 */
export function groupVisitsForInvoicing(input: Array<Visit | BillingUnit>): Map<string, BillingUnit[]> {
  const seen = new Set<string>();
  const groups = new Map<string, BillingUnit[]>();
  for (const x of input) {
    const u = asUnit(x);
    const id = `${u.visit.id}:${u.item?.id ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const key = unitGroupKey(u);
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, u]);
  }
  return groups;
}

/** Sorted once (visitDate, id, then line position) and reused everywhere
 *  within a group — makes every "which visit wins" pick below deterministic
 *  and date-anchored, instead of depending on input array order. */
function sortGroup(units: BillingUnit[]): BillingUnit[] {
  return [...units].sort((a, b) => {
    if (a.visit.visitDate !== b.visit.visitDate) return a.visit.visitDate < b.visit.visitDate ? -1 : 1;
    if (a.visit.id !== b.visit.id) return a.visit.id < b.visit.id ? -1 : 1;
    return (a.item?.position ?? 0) - (b.item?.position ?? 0);
  });
}

export interface BuildLineItemsResult {
  lineItems: InvoiceLineItem[];
  totalPaise: Paise;
  /** Highest total billed across every visit on the invoice wins,
   *  deterministic tiebreak by id — the invoice-level "Therapist: X" print
   *  footer. Fixes a pre-existing bug where this was arbitrarily whichever
   *  group's visits were processed last. */
  therapistId: UUID;
}

/**
 * Builds v2 line items from pre-grouped visits. Takes plain data only (a
 * `serviceNameById` lookup, not a repo) so it's directly unit-testable with
 * no Supabase/network mocking — `invoiceService.ts` resolves the catalog
 * names once and passes the map in.
 */
export function buildLineItems(
  groups: Map<string, BillingUnit[]>,
  serviceNameById: Map<UUID, string>
): BuildLineItemsResult {
  const lineItems: InvoiceLineItem[] = [];
  let totalPaise = 0;
  const billedByTherapist = new Map<UUID, Paise>();

  for (const rawGroup of groups.values()) {
    if (rawGroup.length === 0) continue;
    const ordered = sortGroup(rawGroup);
    const groupBilled = ordered.find((u) => u.netPaise > 0) ?? ordered[0];
    const serviceId = groupBilled.item?.serviceCatalogId ?? groupBilled.visit.serviceCatalogId;
    // A service line prints its own snapshot name; the catalog name is for visits without lines.
    const serviceName = groupBilled.item
      ? groupBilled.item.serviceName || serviceNameById.get(serviceId)
      : serviceNameById.get(serviceId);
    if (!serviceName) throw new Error('Service not found');

    const billedSessionCount = ordered.length;
    // An add-on line on a package visit is not the package: the visit's package columns describe
    // the package line only.
    const authorizedSessionCount = groupBilled.item && !groupBilled.item.isPackageLine
      ? null
      : normalizeAuthorizedCount(groupBilled.visit.packageTotal);
    const sessionCount = authorizedSessionCount ?? billedSessionCount;
    // One date per visit: two lines of one visit count as two sessions but never repeat the date.
    const sessionDates = ordered
      .filter((u, i) => ordered.findIndex((o) => o.visit.id === u.visit.id) === i)
      .map((u) => u.visit.visitDate);
    // Sum of every unit's own snapshot, not one's — the fix that keeps
    // `catalogPricePaise + adjustmentPaise = totalPaise` holding by construction for a merged
    // non-package group too. A service line's adjustment is its net less its catalog price.
    const catalogPricePaise = ordered.reduce(
      (sum, u) => sum + (u.item ? u.item.catalogPricePaise : u.visit.catalogPricePaise),
      0
    );
    const adjustmentPaise = ordered.reduce(
      (sum, u) => sum + (u.item ? u.netPaise - u.item.catalogPricePaise : u.visit.adjustmentPaise),
      0
    );
    const adjustmentReasons = Array.from(
      new Set(
        ordered.map((u) => u.visit.adjustmentReason?.trim()).filter((r): r is string => Boolean(r))
      )
    );
    const groupTotalPaise = ordered.reduce((sum, u) => sum + u.netPaise, 0);
    // The invoice names the primary therapist only (never an assistant).
    const therapistIds = Array.from(new Set(ordered.map((u) => u.visit.therapistId)));
    const ratePerSessionPaise = Math.round(
      catalogPricePaise / Math.max(1, authorizedSessionCount ?? billedSessionCount)
    );

    for (const u of ordered) {
      billedByTherapist.set(
        u.visit.therapistId,
        (billedByTherapist.get(u.visit.therapistId) ?? 0) + u.netPaise
      );
    }

    lineItems.push({
      serviceName,
      sessionCount,
      sessionDates,
      catalogPricePaise,
      adjustmentPaise,
      adjustmentReason: adjustmentReasons.length > 0 ? adjustmentReasons.join('; ') : null,
      totalPaise: groupTotalPaise,
      lineItemVersion: 2,
      billedSessionCount,
      authorizedSessionCount,
      ratePerSessionPaise,
      rateBasis: authorizedSessionCount ? 'package_upfront' : 'per_session',
      adjustmentReasons: adjustmentReasons.length > 0 ? adjustmentReasons : undefined,
      therapistIds,
    });
    totalPaise += groupTotalPaise;
  }

  let therapistId: UUID | undefined;
  let bestAmount = -1;
  const candidates = Array.from(billedByTherapist.entries()).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
  );
  for (const [id, amount] of candidates) {
    if (amount > bestAmount) {
      bestAmount = amount;
      therapistId = id;
    }
  }
  if (!therapistId) throw new Error('No visits to invoice');

  return { lineItems, totalPaise, therapistId };
}
