import type { InvoiceLineItem, UUID, Visit } from './types';
import type { Paise } from './money';

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

/**
 * Pure grouping over an already-resolved, already-package-expanded flat
 * visit list (the caller — `invoiceService.ts` — is responsible for
 * fetching a visit's full package siblings before calling this; that part
 * needs `repos`, so it can't live in this pure module). Dedupes by id
 * defensively, since the same visit can appear twice when two selected
 * visits belong to the same package.
 */
export function groupVisitsForInvoicing(visits: Visit[]): Map<string, Visit[]> {
  const seen = new Set<UUID>();
  const groups = new Map<string, Visit[]>();
  for (const v of visits) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    const key = invoiceLineGroupKey(v);
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, v]);
  }
  return groups;
}

/** Sorted once (visitDate then id, both ascending) and reused everywhere
 *  within a group — makes every "which visit wins" pick below deterministic
 *  and date-anchored, instead of depending on input array order. */
function sortGroup(visits: Visit[]): Visit[] {
  return [...visits].sort((a, b) => {
    if (a.visitDate !== b.visitDate) return a.visitDate < b.visitDate ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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
  groups: Map<string, Visit[]>,
  serviceNameById: Map<UUID, string>
): BuildLineItemsResult {
  const lineItems: InvoiceLineItem[] = [];
  let totalPaise = 0;
  const billedByTherapist = new Map<UUID, Paise>();

  for (const rawGroup of groups.values()) {
    if (rawGroup.length === 0) continue;
    const ordered = sortGroup(rawGroup);
    const groupBilled = ordered.find((v) => v.actualBillPaise > 0) ?? ordered[0];
    const serviceName = serviceNameById.get(groupBilled.serviceCatalogId);
    if (!serviceName) throw new Error('Service not found');

    const billedSessionCount = ordered.length;
    const authorizedSessionCount = normalizeAuthorizedCount(groupBilled.packageTotal);
    const sessionCount = authorizedSessionCount ?? billedSessionCount;
    const sessionDates = ordered.map((v) => v.visitDate);
    // Sum of every visit's own snapshot, not one visit's — the fix that
    // keeps `catalogPricePaise + adjustmentPaise = totalPaise` holding by
    // construction for a merged non-package group too, not just packages
    // (whose ₹0 continuations already summed to the right total by luck).
    const catalogPricePaise = ordered.reduce((sum, v) => sum + v.catalogPricePaise, 0);
    const adjustmentPaise = ordered.reduce((sum, v) => sum + v.adjustmentPaise, 0);
    const adjustmentReasons = Array.from(
      new Set(ordered.map((v) => v.adjustmentReason?.trim()).filter((r): r is string => Boolean(r)))
    );
    const groupTotalPaise = ordered.reduce((sum, v) => sum + v.actualBillPaise, 0);
    const therapistIds = Array.from(new Set(ordered.map((v) => v.therapistId)));
    const ratePerSessionPaise = Math.round(
      catalogPricePaise / Math.max(1, authorizedSessionCount ?? billedSessionCount)
    );

    for (const v of ordered) {
      billedByTherapist.set(
        v.therapistId,
        (billedByTherapist.get(v.therapistId) ?? 0) + v.actualBillPaise
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
