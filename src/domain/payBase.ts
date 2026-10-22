import type { UUID, Visit, VisitCredit, VisitItem } from './types';
import type { Paise } from './money';
import { roundToRupeeHalfUp } from './money';
import { autoCredits, deliverer, lineNets } from './visitLines';

/**
 * Pay base — the ONE place that decides how much of each visit's money
 * counts under each therapist. Reports (Shared / Net), the attribution
 * audit, and payroll all read from here, so they can never disagree.
 *
 * A visit's billed amounts start under its primary therapist; every
 * `Movement` then moves an equal-and-opposite slice from one therapist to
 * another. Movements never create or destroy money, so clinic-wide totals
 * are always exactly the sum of the visits' own stored figures.
 *
 * Pure: callers fetch the visits, their package groups (reportService via
 * `repos.visits.listByPackageGroup`) and the service lines / revenue shares
 * of every visit involved, and pass them in.
 */

export type Movement = {
  mechanism: 'manual_split' | 'package_attribution' | 'line_share';
  /** The visit whose delivery earned the move (for packages: the session, not the billing visit). */
  visitId: UUID;
  fromTherapistId: UUID;
  toTherapistId: UUID;
  /** Bill-based amount moved. Package attribution moves none — it has never had a gross-level equivalent. */
  grossPaise: Paise;
  clinicSharePaise: Paise;
  postTaxPaise: Paise;
  /**
   * `line_share` only: the visit's stored revenue shares didn't add up to its bill, so they were
   * recomputed from its service lines (`autoCredits`) for this report. Absent when the rows were used as stored.
   */
  repaired?: boolean;
};

export interface PayBaseInput {
  /** The visits dated inside [from, to]. */
  visits: Visit[];
  /** Every package group any of `visits` belongs to — the FULL group, all dates. */
  packageGroups: Map<UUID, Visit[]>;
  /**
   * Service lines by visit id, for every visit in `visits` and in `packageGroups`. A visit with no
   * (live) lines is a visit without lines — today's rules apply to it. Empty map = no visit has lines.
   */
  items: Map<UUID, VisitItem[]>;
  /** Revenue shares (VisitCredit rows) by visit id, same coverage as `items`. */
  credits: Map<UUID, VisitCredit[]>;
  /** The clinic's `enableTherapistSplit` (default true) — used when repairing shares and to name a package's biller. */
  splitEnabled?: boolean;
  from: string;
  to: string;
}

export interface PayBase {
  grossPaise: Paise;
  clinicSharePaise: Paise;
  postTaxPaise: Paise;
}

/** Package groups that can attribute anything: multi-session packages only. */
export function attributablePackageGroupIds(visits: Visit[]): UUID[] {
  return [
    ...new Set(
      visits.filter((v) => v.packageGroupId && (v.packageTotal ?? 1) > 1).map((v) => v.packageGroupId!)
    ),
  ];
}

const live = <T extends { deleted: boolean }>(rows: T[] | undefined): T[] => (rows ?? []).filter((r) => !r.deleted);

/** The visit's live package line, if it has lines at all. */
function packageLineOf(items: Map<UUID, VisitItem[]>, visitId: UUID): VisitItem | undefined {
  return live(items.get(visitId)).find((i) => i.isPackageLine);
}

/**
 * Splits `total` over `weights` in proportion, in whole rupees, so the parts sum exactly to `total`:
 * each part gets the floor of its exact rupee share, leftover rupees go one each to the largest
 * fractional remainders (ties: lower index first — callers put the primary at index 0), and any stray
 * paise of `total` go to index 0. Integer arithmetic throughout; Σweights must be > 0.
 */
function proportionalRupees(weights: Paise[], total: Paise): Paise[] {
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const units = Math.floor(abs / 100);
  const parts = weights.map((w, idx) => ({ idx, rupees: Math.floor((units * w) / weightSum), remainder: (units * w) % weightSum }));
  let leftover = units - parts.reduce((s, p) => s + p.rupees, 0);
  const ranking = [...parts].sort((a, b) => b.remainder - a.remainder || a.idx - b.idx);
  for (let k = 0; leftover > 0; k += 1, leftover -= 1) ranking[k].rupees += 1;
  const out = parts.map((p) => p.rupees * 100);
  out[0] += abs - units * 100;
  return out.map((x) => sign * x);
}

/**
 * The revenue-share movements of one visit that has live credit rows: one `line_share` per
 * non-primary therapist, from the primary. Gross = the therapist's share; clinic share and Post-Tax =
 * the same proportion of the visit's own figures (share ÷ bill), whole rupees by largest remainder
 * across all of the visit's shares with the primary first in line — so each base still sums exactly
 * to the visit's figure and any stray paise stay on the primary. Rows that don't add up to the bill
 * (or carry a negative share) are recomputed with `autoCredits` and every movement is flagged `repaired`.
 */
function lineShareMovements(v: Visit, rows: VisitCredit[], items: VisitItem[], splitEnabled: boolean): Movement[] {
  const bill = v.actualBillPaise;
  let shares = rows.map((r) => ({ therapistId: r.therapistId, amountPaise: r.amountPaise }));
  const valid = shares.every((r) => r.amountPaise >= 0) && shares.reduce((s, r) => s + r.amountPaise, 0) === bill;
  if (!valid) shares = autoCredits(items, v.therapistId, bill, { splitEnabled });
  if (bill <= 0) return [];

  // One merged amount per therapist, the primary first (its amount is whatever the others leave).
  const byTherapist = new Map<UUID, Paise>([[v.therapistId, 0]]);
  for (const r of shares) byTherapist.set(r.therapistId, (byTherapist.get(r.therapistId) ?? 0) + r.amountPaise);
  const others = [...byTherapist].filter(([id, amount]) => id !== v.therapistId && amount > 0);
  if (others.length === 0) return [];
  const weights = [bill - others.reduce((s, [, a]) => s + a, 0), ...others.map(([, a]) => a)];
  const clinic = proportionalRupees(weights, v.clinicSharePaise);
  const postTax = proportionalRupees(weights, v.postTaxPaise);
  return others.map(([therapistId, amount], k) => ({
    mechanism: 'line_share' as const,
    visitId: v.id,
    fromTherapistId: v.therapistId,
    toTherapistId: therapistId,
    grossPaise: amount,
    clinicSharePaise: clinic[k + 1],
    postTaxPaise: postTax[k + 1],
    ...(valid ? {} : { repaired: true as const }),
  }));
}

/**
 * Who ran a package session: the deliverer of that visit's package line, or — for a visit without
 * lines — the visit's therapist, as before lines existed.
 */
export function packageSessionRunner(g: Visit, items: Map<UUID, VisitItem[]> = new Map()): UUID {
  const line = packageLineOf(items, g.id);
  return line ? deliverer(line, g.therapistId) : g.therapistId;
}

/**
 * How a package group's price divides per session.
 *
 * The "billing visit" is the one carrying the package's price: the visit whose live package line has
 * `pricePaise > 0`. Failing that (a group billed before lines existed), today's rule over the visits
 * WITHOUT lines — the largest bill — so a later continuation with a paid add-on can never become the
 * billing visit; failing that too, the largest bill in the group.
 *
 * The base is the package's share of the billing visit's figures: with a package line, that line's
 * net (`lineNets`) ÷ the bill × the visit's Post-Tax / clinic share, rounded half-up to the rupee — so
 * a consultation billed in the same visit never leaks into the sessions; without lines, the visit's
 * whole figures, as before. Each per-session share is that base ÷ the DECLARED session count, floored
 * to whole rupees, so it stays stable however many sessions have been logged and whichever month asks.
 *
 * The biller is whoever holds the package money: the package line's deliverer (the credits rule always
 * gives the package line's net to its deliverer) — or the visit's primary when the clinic's therapist
 * split is off (every rupee is then credited to the primary) or the visit has no lines.
 */
export function packageSessionShares(group: Visit[], items: Map<UUID, VisitItem[]> = new Map(), splitEnabled = true) {
  const packageTotal = group[0]?.packageTotal || group.length;
  const maxBill = (vs: Visit[]) => vs.reduce((max, g) => (g.actualBillPaise > max.actualBillPaise ? g : max), vs[0]);

  let billingVisit: Visit | undefined;
  let packageLine: VisitItem | undefined;
  for (const g of group) {
    const line = packageLineOf(items, g.id);
    if (line && line.pricePaise > 0 && (!packageLine || line.pricePaise > packageLine.pricePaise)) {
      billingVisit = g;
      packageLine = line;
    }
  }
  if (!billingVisit) {
    const withoutLines = group.filter((g) => live(items.get(g.id)).length === 0);
    billingVisit = maxBill(withoutLines.length ? withoutLines : group);
  }

  let basePostTax = billingVisit.postTaxPaise;
  let baseClinicShare = billingVisit.clinicSharePaise;
  let packagePricePaise = billingVisit.actualBillPaise;
  let billerId = billingVisit.therapistId;
  if (packageLine) {
    const bill = billingVisit.actualBillPaise;
    const net = lineNets(live(items.get(billingVisit.id)), bill).get(packageLine.id) ?? 0;
    basePostTax = bill > 0 ? roundToRupeeHalfUp((net * billingVisit.postTaxPaise) / bill) : 0;
    baseClinicShare = bill > 0 ? roundToRupeeHalfUp((net * billingVisit.clinicSharePaise) / bill) : 0;
    packagePricePaise = net;
    if (splitEnabled) billerId = deliverer(packageLine, billingVisit.therapistId);
  }

  const perSession = (paise: Paise): Paise => Math.floor(paise / 100 / packageTotal) * 100;
  return {
    billingVisit,
    billerId,
    packageTotal,
    /** What the package itself sold for: the package line's net, or (no lines) the billing visit's bill. */
    packagePricePaise,
    postTaxPaise: perSession(basePostTax),
    clinicSharePaise: perSession(baseClinicShare),
  };
}

/**
 * Every therapist-to-therapist movement for the [from, to] window:
 *
 * (1) Revenue shares. A visit with live credit rows (VisitCredit) moves one
 * `line_share` per non-primary therapist (see lineShareMovements). A visit
 * without credit rows keeps the legacy rule, `manual_split`: `sharedPct` of
 * its bill, clinic share and Post-Tax each move from the primary to the
 * assisting therapist, rounded half-up to the whole rupee per visit — so
 * closed months reproduce to the rupee. Credit rows replace the legacy
 * split; the two never both apply to a visit.
 *
 * (2) `package_attribution` — for every session of a multi-session package
 * whose own visitDate falls inside [from, to] and was run (packageSessionRunner)
 * by a therapist other than the biller, one per-session share (see
 * packageSessionShares) moves from the biller to that therapist. Settlement
 * is scoped to the window so a package spanning several months settles one
 * month at a time, and a closed month's figures never change when a later
 * session is logged. Any share not claimed this way — including sessions
 * not yet logged — stays with the biller; nothing is ever left unattributed.
 * Overlogging beyond the declared total can, in theory, give away more
 * than the billing visit's total — rare, self-correcting once the package
 * total is fixed; not worth guarding speculatively.
 */
export function attributionMovements(input: PayBaseInput): Movement[] {
  const { visits, packageGroups, items, credits, from, to } = input;
  const splitEnabled = input.splitEnabled ?? true;
  const movements: Movement[] = [];

  for (const v of visits) {
    const rows = live(credits.get(v.id));
    if (rows.length > 0) {
      movements.push(...lineShareMovements(v, rows, live(items.get(v.id)), splitEnabled));
      continue;
    }
    if (!v.sharedTherapistId || !v.sharedPct) continue;
    movements.push({
      mechanism: 'manual_split',
      visitId: v.id,
      fromTherapistId: v.therapistId,
      toTherapistId: v.sharedTherapistId,
      grossPaise: roundToRupeeHalfUp((v.actualBillPaise * v.sharedPct) / 100),
      clinicSharePaise: roundToRupeeHalfUp((v.clinicSharePaise * v.sharedPct) / 100),
      postTaxPaise: roundToRupeeHalfUp((v.postTaxPaise * v.sharedPct) / 100),
    });
  }

  for (const groupId of attributablePackageGroupIds(visits)) {
    const group = packageGroups.get(groupId);
    if (!group?.length) continue;
    const { billingVisit, billerId, postTaxPaise, clinicSharePaise } = packageSessionShares(group, items, splitEnabled);
    if (postTaxPaise <= 0) continue;
    for (const g of group) {
      if (g.visitDate < from || g.visitDate > to) continue;
      if (g.id === billingVisit.id) continue;
      const runner = packageSessionRunner(g, items);
      if (runner === billerId) continue;
      movements.push({
        mechanism: 'package_attribution',
        visitId: g.id,
        fromTherapistId: billerId,
        toTherapistId: runner,
        grossPaise: 0,
        clinicSharePaise,
        postTaxPaise,
      });
    }
  }

  return movements;
}

/**
 * Each therapist's money for the window: every visit's billed amounts under
 * its primary therapist, then every movement applied. A therapist touched
 * only by a movement still gets an entry (possibly negative — e.g. the
 * biller of last month's package when a colleague runs this month's
 * session), because dropping it would credit the colleague without
 * debiting anyone. Σ over therapists always equals Σ over visits.
 */
export function payBaseByTherapist(input: PayBaseInput): Map<UUID, PayBase> {
  const base = new Map<UUID, PayBase>();
  const entry = (id: UUID): PayBase =>
    base.get(id) ?? base.set(id, { grossPaise: 0, clinicSharePaise: 0, postTaxPaise: 0 }).get(id)!;

  for (const v of input.visits) {
    const e = entry(v.therapistId);
    e.grossPaise += v.actualBillPaise;
    e.clinicSharePaise += v.clinicSharePaise;
    e.postTaxPaise += v.postTaxPaise;
  }
  for (const m of attributionMovements(input)) {
    const from = entry(m.fromTherapistId);
    const to = entry(m.toTherapistId);
    from.grossPaise -= m.grossPaise;
    to.grossPaise += m.grossPaise;
    from.clinicSharePaise -= m.clinicSharePaise;
    to.clinicSharePaise += m.clinicSharePaise;
    from.postTaxPaise -= m.postTaxPaise;
    to.postTaxPaise += m.postTaxPaise;
  }
  return base;
}
