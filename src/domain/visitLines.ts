import { type Paise, roundToRupeeHalfUp } from './money';
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
 * Integer arithmetic throughout (remainders compared as `units × price mod Σprice`), so no float drift.
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

  const units = Math.floor(billPaise / 100); // whole rupees to share out
  const strayPaise = billPaise - units * 100;

  const shares = lines.map((l, idx) => {
    const exact = units * l.pricePaise;
    return { id: l.id, idx, rupees: Math.floor(exact / totalPrice), remainder: exact % totalPrice };
  });
  let leftover = units - shares.reduce((s, x) => s + x.rupees, 0);

  // Largest remainder first; `lines` is already in position/id order, so idx breaks ties.
  const ranking = [...shares].sort((a, b) => b.remainder - a.remainder || a.idx - b.idx);
  let next = 0;
  while (leftover > 0) {
    ranking[next].rupees += 1;
    next += 1;
    leftover -= 1;
  }

  for (const s of shares) nets.set(s.id, s.rupees * 100);
  // `next` < lines.length always: the handed-out rupees are fewer than the lines (Σ fractions < n).
  if (strayPaise > 0) {
    const target = ranking[next];
    nets.set(target.id, (nets.get(target.id) ?? 0) + strayPaise);
  }
  return nets;
}

/**
 * The visit's revenue shares in 'auto' mode: each therapist's share is the sum of the nets of the lines
 * they delivered. The package line's net therefore always goes to that line's deliverer (package money
 * is never redistributed here). The primary is always present (first), even at ₹0; others follow in
 * the order they first appear on the visit, one merged row each.
 * Split off (`clinics.enable_therapist_split` false) or a ₹0 bill → a single primary row for the bill.
 */
export function autoCredits(
  items: VisitItem[],
  primaryId: UUID,
  billPaise: Paise,
  opts: { splitEnabled: boolean },
): CreditShare[] {
  if (!opts.splitEnabled || billPaise === 0) {
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

/**
 * Applies one hand edit in the share editor. Sets a non-primary therapist's share — by ₹, or by % of
 * the bill (rounded to the rupee, half-up); ₹ wins if both are given — and lets the primary's row
 * absorb the difference, so the shares always total the bill. A therapist not yet in `current` gets a
 * row. Package money (`lockedPaise`) is not hand-editable, so no share may exceed the editable pool
 * `billPaise − lockedPaise`, and no row (including the primary's remainder) may go below ₹0; either
 * throws SHARE_TOO_LARGE. Keeping the package money with its holder is the caller's job (it knows
 * which row holds it); this function only guards the pool.
 */
export function rebalanceCredits(
  current: CreditShare[],
  edit: { therapistId: UUID; amountPaise?: Paise; pct?: number },
  primaryId: UUID,
  billPaise: Paise,
  lockedPaise: Paise,
): CreditShare[] {
  if (edit.therapistId === primaryId) {
    throw new Error("The primary therapist's share is the remainder; edit another therapist's share.");
  }
  const amount = edit.amountPaise ?? roundToRupeeHalfUp((billPaise * (edit.pct ?? 0)) / 100);
  if (amount < 0 || amount > billPaise - lockedPaise) throw new Error(SHARE_TOO_LARGE);

  const rows = current.map((r) => ({ ...r }));
  if (!rows.some((r) => r.therapistId === primaryId)) rows.unshift({ therapistId: primaryId, amountPaise: 0 });
  const edited = rows.find((r) => r.therapistId === edit.therapistId);
  if (edited) edited.amountPaise = amount;
  else rows.push({ therapistId: edit.therapistId, amountPaise: amount });

  const others = rows.filter((r) => r.therapistId !== primaryId).reduce((s, r) => s + r.amountPaise, 0);
  const primaryAmount = billPaise - others;
  if (primaryAmount < 0) throw new Error(SHARE_TOO_LARGE);
  for (const r of rows) if (r.therapistId === primaryId) r.amountPaise = primaryAmount;
  return rows;
}

/**
 * Minutes a therapist is counted for on one visit (utilisation). Nobody enters time:
 * - not delivering any live line → 0;
 * - every line they delivered has a duration → the sum of those durations;
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
  return sum;
}
