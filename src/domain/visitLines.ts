import { type Paise, largestRemainderRupees, roundToRupeeHalfUp } from './money';
import type { UUID, VisitItem } from './types';

/**
 * Line math for multi-service, multi-therapist visits: how a visit's bill is spread over its service
 * lines, how that turns into revenue shares (credits) per therapist, and how much time each therapist
 * is counted for. Pure — no storage, no clock — so the visit service, the share editor and the reports
 * all compute the same figures from the same rows. Soft-deleted lines are ignored everywhere.
 */

/** One therapist's revenue share of a visit, before it is stored as a VisitCredit row. */
export interface CreditShare {
  therapistId: UUID;
  amountPaise: Paise;
}

/**
 * Who delivered a line: the tagged assistant, or the visit's primary when none is tagged. Lines store
 * null for the primary so changing the visit's therapist needs no line updates.
 */
export function deliverer(item: Pick<VisitItem, 'assistingTherapistId'>, primaryId: UUID): UUID {
  return item.assistingTherapistId ?? primaryId;
}

/** Live lines in display order (position, then id), so every tie-break below is deterministic. */
function liveLines(items: VisitItem[]): VisitItem[] {
  return items
    .filter((i) => !i.deleted)
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Each line's net amount: the bill spread over the lines in proportion to their `pricePaise`, so a
 * visit-level discount (or surcharge) lands on every line pro rata. Nets are whole rupees, like every
 * other computed money figure in the app (see `roundToRupeeHalfUp`), and always sum exactly to
 * `billPaise`:
 * - the bill's whole rupees are shared out by largest remainder — each line gets the floor of its exact
 *   share, then the leftover rupees go one each to the lines with the largest fractional remainders
 *   (ties: line position, then id);
 * - if the bill itself has stray paise (not a whole rupee), they go to the line that would have been
 *   next in line for a rupee, so the sum is still exact.
 * Integer arithmetic throughout (`largestRemainderRupees`, the one rule shared with the pay base).
 * All-zero prices (e.g. a ₹0 package session) → the whole bill on the first line.
 * Worked example: ₹1,000 + ₹500 billed at ₹1,300 → ₹867 and ₹433.
 */
export function lineNets(items: VisitItem[], billPaise: Paise): Map<UUID, Paise> {
  const lines = liveLines(items);
  const nets = new Map<UUID, Paise>();
  if (lines.length === 0) return nets;

  const totalPrice = lines.reduce((s, l) => s + l.pricePaise, 0);
  if (totalPrice <= 0) {
    lines.forEach((l, idx) => nets.set(l.id, idx === 0 ? billPaise : 0));
    return nets;
  }

  const parts = largestRemainderRupees(
    lines.map((l) => l.pricePaise),
    billPaise,
  );
  lines.forEach((l, idx) => nets.set(l.id, parts[idx]));
  return nets;
}

/**
 * The visit's revenue shares in 'auto' mode: each therapist's share is the sum of the nets of the lines
 * they delivered. The package line's net therefore always goes to that line's deliverer (package money
 * is never redistributed here). The primary is always present (first), even at ₹0; others follow in
 * the order they first appear on the visit, one merged row each.
 * Split off (`clinics.enable_therapist_split` false) overrides the package rule: every rupee, package
 * money included, goes to the primary. A ₹0 bill, or a visit with no live lines, also gives a single
 * primary row for the whole bill, so the shares always add up to the bill.
 */
export function autoCredits(
  items: VisitItem[],
  primaryId: UUID,
  billPaise: Paise,
  opts: { splitEnabled: boolean },
): CreditShare[] {
  if (!opts.splitEnabled || billPaise === 0 || liveLines(items).length === 0) {
    return [{ therapistId: primaryId, amountPaise: billPaise }];
  }
  const nets = lineNets(items, billPaise);
  const totals = new Map<UUID, Paise>([[primaryId, 0]]);
  for (const l of liveLines(items)) {
    const who = deliverer(l, primaryId);
    totals.set(who, (totals.get(who) ?? 0) + (nets.get(l.id) ?? 0));
  }
  return [...totals].map(([therapistId, amountPaise]) => ({ therapistId, amountPaise }));
}

export const SHARE_TOO_LARGE = "A share can't be more than the bill (less package money).";
export const SHARE_BELOW_PACKAGE = "A share can't be less than the package money it holds.";
export const SHARE_BELOW_ZERO = "A share can't be less than ₹0.";
export const SHARE_MISSING = 'Enter the share in ₹ or as a % of the bill.';

/**
 * Applies one hand edit in the share editor. Rows are each therapist's TOTAL share of the bill. Sets a
 * non-primary therapist's share — by ₹, or by % of the bill (rounded to the rupee, half-up); ₹ wins if
 * both are given — and lets the primary's row absorb the difference, so the shares always total the
 * bill. A therapist not yet in `current` gets a row.
 *
 * Package money is not hand-editable (it moves only through package attribution), so `locked` names
 * the row holding it — the package line's deliverer, who may be an assistant — and that row may never
 * go below `locked.amountPaise`; every other row never below ₹0. Editing the holder's row to at least
 * its package money is fine. Throws SHARE_BELOW_PACKAGE / SHARE_BELOW_ZERO if the edited row breaks
 * its floor, SHARE_TOO_LARGE if the primary's resulting remainder would, and SHARE_MISSING if the edit
 * carries neither a ₹ amount nor a finite %.
 */
export function rebalanceCredits(
  current: CreditShare[],
  edit: { therapistId: UUID; amountPaise?: Paise; pct?: number },
  primaryId: UUID,
  billPaise: Paise,
  locked: { therapistId: UUID; amountPaise: Paise } | null,
): CreditShare[] {
  if (edit.therapistId === primaryId) {
    throw new Error("The primary therapist's share is the remainder; edit another therapist's share.");
  }
  let amount: Paise;
  if (edit.amountPaise != null && Number.isFinite(edit.amountPaise)) amount = edit.amountPaise;
  else if (edit.pct != null && Number.isFinite(edit.pct)) amount = roundToRupeeHalfUp((billPaise * edit.pct) / 100);
  else throw new Error(SHARE_MISSING);

  const floor = (therapistId: UUID): Paise => (locked && locked.therapistId === therapistId ? locked.amountPaise : 0);
  if (amount < floor(edit.therapistId)) {
    throw new Error(floor(edit.therapistId) > 0 ? SHARE_BELOW_PACKAGE : SHARE_BELOW_ZERO);
  }

  const rows = current.map((r) => ({ ...r }));
  if (!rows.some((r) => r.therapistId === primaryId)) rows.unshift({ therapistId: primaryId, amountPaise: 0 });
  const edited = rows.find((r) => r.therapistId === edit.therapistId);
  if (edited) edited.amountPaise = amount;
  else rows.push({ therapistId: edit.therapistId, amountPaise: amount });

  const others = rows.filter((r) => r.therapistId !== primaryId).reduce((s, r) => s + r.amountPaise, 0);
  const primaryAmount = billPaise - others;
  if (primaryAmount < floor(primaryId)) throw new Error(SHARE_TOO_LARGE);
  for (const r of rows) if (r.therapistId === primaryId) r.amountPaise = primaryAmount;
  return rows;
}

/**
 * Who was treated on a visit: the deliverers of its live lines, or the visit's own therapist when it has
 * none. The one rule behind "patients treated" in the reports and utilisation.
 */
export function treatedTherapists(items: VisitItem[], primaryId: UUID): Set<UUID> {
  const lines = liveLines(items);
  return new Set(lines.length > 0 ? lines.map((l) => deliverer(l, primaryId)) : [primaryId]);
}

/**
 * Minutes a therapist is counted for on one visit (utilisation). Nobody enters time:
 * - not delivering any live line → 0;
 * - every line they delivered has a duration → the sum of those durations, capped at the sitting;
 * - otherwise → the sitting's length (`sittingMinutes`: the linked appointment's length, else the clinic
 *   slot), once — more services in one sitting never count as more sittings.
 * Revenue shares never move time.
 */
export function therapistMinutes(
  items: VisitItem[],
  primaryId: UUID,
  therapistId: UUID,
  sittingMinutes: number,
): number {
  const theirs = liveLines(items).filter((l) => deliverer(l, primaryId) === therapistId);
  if (theirs.length === 0) return 0;
  let sum = 0;
  for (const l of theirs) {
    if (l.durationMinutes == null) return sittingMinutes;
    sum += l.durationMinutes;
  }
  return Math.min(sum, sittingMinutes);
}
