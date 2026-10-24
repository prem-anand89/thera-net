import type { UUID, Visit, VisitCredit, VisitItem } from './types';
import type { Paise } from './money';
import { largestRemainderRupees, roundToRupeeHalfUp } from './money';
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
   * `line_share` only: the visit's stored revenue shares weren't valid (no primary row, a negative share,
   * or not summing to the bill), so they were recomputed from its service lines (`autoCredits`) for this report. Absent when the rows were used as stored.
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
  /** The clinic's `enableTherapistSplit` (default true) — used when repairing shares and to name a package session's runner. */
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
 * The revenue shares a visit is reported with, or null when it has no live credit rows (it then keeps
 * the legacy split). Stored rows count as valid only if they include a row for the primary, hold no
 * negative amount and sum exactly to the bill; otherwise they are recomputed from the visit's live lines
 * with `autoCredits` (using the clinic's split setting) and marked `repaired`. One merged amount per
 * therapist, the primary first.
 */
function effectiveCredits(
  v: Visit,
  input: Pick<PayBaseInput, 'items' | 'credits' | 'splitEnabled'>
): { byTherapist: Map<UUID, Paise>; repaired: boolean } | null {
  const rows = live(input.credits.get(v.id));
  if (rows.length === 0) return null;
  const bill = v.actualBillPaise;
  const valid =
    rows.some((r) => r.therapistId === v.therapistId) &&
    rows.every((r) => r.amountPaise >= 0) &&
    rows.reduce((s, r) => s + r.amountPaise, 0) === bill;
  const shares = valid
    ? rows
    : autoCredits(live(input.items.get(v.id)), v.therapistId, bill, { splitEnabled: input.splitEnabled ?? true });
  const byTherapist = new Map<UUID, Paise>([[v.therapistId, 0]]);
  for (const r of shares) byTherapist.set(r.therapistId, (byTherapist.get(r.therapistId) ?? 0) + r.amountPaise);
  return { byTherapist, repaired: !valid };
}

/**
 * The revenue-share movements of one visit with live credit rows (see effectiveCredits): one
 * `line_share` per non-primary therapist, from the primary. Gross = the therapist's share; clinic share
 * and Post-Tax = the same proportion of the visit's own figures (share ÷ bill), split over all the
 * visit's shares (primary at index 0) with `largestRemainderRupees` — so each base sums exactly to the
 * visit's figure. Movements from repaired shares are flagged `repaired`; a repair that leaves
 * everything on the primary moves nothing, so it produces no movement at all.
 */
function lineShareMovements(v: Visit, credits: NonNullable<ReturnType<typeof effectiveCredits>>): Movement[] {
  const bill = v.actualBillPaise;
  if (bill <= 0) return [];
  const others = [...credits.byTherapist].filter(([id, amount]) => id !== v.therapistId && amount > 0);
  if (others.length === 0) return [];
  const weights = [bill - others.reduce((s, [, a]) => s + a, 0), ...others.map(([, a]) => a)];
  const clinic = largestRemainderRupees(weights, v.clinicSharePaise);
  const postTax = largestRemainderRupees(weights, v.postTaxPaise);
  return others.map(([therapistId, amount], k) => ({
    mechanism: 'line_share' as const,
    visitId: v.id,
    fromTherapistId: v.therapistId,
    toTherapistId: therapistId,
    grossPaise: amount,
    clinicSharePaise: clinic[k + 1],
    postTaxPaise: postTax[k + 1],
    ...(credits.repaired ? { repaired: true } : {}),
  }));
}

/** The helper a session's package line gives part of the session to, if any (live line, both fields set). */
function sessionShareOf(
  items: Map<UUID, VisitItem[]>,
  visitId: UUID
): { therapistId: UUID; pct: number } | undefined {
  const line = packageLineOf(items, visitId);
  if (!line?.sessionShareTherapistId || !line.sessionSharePct) return undefined;
  return { therapistId: line.sessionShareTherapistId, pct: line.sessionSharePct };
}

/**
 * Who ran a package session. Split on: the deliverer of that visit's package line. Split off (every
 * rupee stays with a visit's primary): the visit's primary. A visit without lines: its therapist, as
 * before lines existed. Unlike the biller, this follows the CURRENT setting, so toggling the clinic's
 * therapist split re-attributes package sessions in every month (closed ones included).
 */
export function packageSessionRunner(
  g: Visit,
  items: Map<UUID, VisitItem[]> = new Map(),
  splitEnabled = true
): UUID {
  const line = splitEnabled ? packageLineOf(items, g.id) : undefined;
  return line ? deliverer(line, g.therapistId) : g.therapistId;
}

/**
 * How a package group's price divides per session.
 *
 * The "billing visit" is the one carrying the package's price: the visit whose live package line has
 * `pricePaise > 0`. Failing that, a group billed before lines existed: today's rule over the visits
 * WITHOUT lines — the largest bill — so a later continuation with a paid add-on can never become the
 * billing visit. A group where every visit has lines but none has a priced package line has nothing to
 * attribute (`billingVisit` null, shares ₹0).
 *
 * The base is the package's share of the billing visit's figures: with a package line, that line's
 * part of the visit's Post-Tax / clinic share when they are split over the visit's live lines by their
 * nets (`lineNets`) with `largestRemainderRupees` — the same rule `line_share` uses — so a consultation
 * billed in the same visit never leaks into the sessions; without lines, the visit's whole figures, as
 * before. Each per-session share is that base ÷ the DECLARED session count, floored to whole rupees, so
 * it stays stable however many sessions have been logged and whichever month asks.
 *
 * The biller comes from the STORED shares, never the live setting: the package line's deliverer if
 * that therapist's effective credit on the billing visit (stored rows if valid, else the repaired ones)
 * is at least the package line's net — i.e. they hold the package money — otherwise the billing
 * visit's primary (who holds it when the visit was billed with split off, or has no shares). A visit
 * without lines: its therapist.
 */
export function packageSessionShares(
  group: Visit[],
  lines: Pick<PayBaseInput, 'items' | 'credits' | 'splitEnabled'> = { items: new Map(), credits: new Map() }
) {
  const { items } = lines;
  const packageTotal = group[0]?.packageTotal || group.length;

  let billingVisit: Visit | null = null;
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
    billingVisit = withoutLines.length
      ? withoutLines.reduce((max, g) => (g.actualBillPaise > max.actualBillPaise ? g : max), withoutLines[0])
      : null;
  }
  if (!billingVisit) {
    return { billingVisit, billerId: null, packageTotal, packagePricePaise: 0, postTaxPaise: 0, clinicSharePaise: 0 };
  }

  let basePostTax = billingVisit.postTaxPaise;
  let baseClinicShare = billingVisit.clinicSharePaise;
  let packagePricePaise = billingVisit.actualBillPaise;
  let billerId = billingVisit.therapistId;
  if (packageLine) {
    const bill = billingVisit.actualBillPaise;
    const visitLines = live(items.get(billingVisit.id)).sort(
      (a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
    const nets = lineNets(visitLines, bill);
    const net = nets.get(packageLine.id) ?? 0;
    const weights = visitLines.map((l) => nets.get(l.id) ?? 0);
    const at = visitLines.findIndex((l) => l.id === packageLine.id);
    const partOf = (total: Paise) => (bill > 0 && net > 0 ? largestRemainderRupees(weights, total)[at] : 0);
    basePostTax = partOf(billingVisit.postTaxPaise);
    baseClinicShare = partOf(billingVisit.clinicSharePaise);
    packagePricePaise = net;
    const holder = deliverer(packageLine, billingVisit.therapistId);
    // No credit rows → the primary holds the bill, and the primary is already the default biller.
    if ((effectiveCredits(billingVisit, lines)?.byTherapist.get(holder) ?? 0) >= net) billerId = holder;
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
  const { visits, packageGroups, items, from, to } = input;
  const splitEnabled = input.splitEnabled ?? true;
  const movements: Movement[] = [];

  for (const v of visits) {
    const credits = effectiveCredits(v, input);
    if (credits) {
      movements.push(...lineShareMovements(v, credits));
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
    const { billingVisit, billerId, postTaxPaise, clinicSharePaise } = packageSessionShares(group, input);
    if (!billingVisit || !billerId || postTaxPaise <= 0) continue;
    for (const g of group) {
      if (g.visitDate < from || g.visitDate > to) continue;
      const part = splitEnabled ? sessionShareOf(items, g.id) : undefined;
      // The billing visit's own session is the biller's unless someone was given part of it.
      if (g.id === billingVisit.id && !part) continue;
      const runner = packageSessionRunner(g, items, splitEnabled);
      // A helper's part comes off the session's share; the runner keeps the rest.
      const helperClinic = part ? roundToRupeeHalfUp((clinicSharePaise * part.pct) / 100) : 0;
      const helperPostTax = part ? roundToRupeeHalfUp((postTaxPaise * part.pct) / 100) : 0;
      const recipients: { id: UUID; clinic: Paise; postTax: Paise }[] = [
        { id: runner, clinic: clinicSharePaise - helperClinic, postTax: postTaxPaise - helperPostTax },
      ];
      if (part && part.therapistId !== runner) {
        recipients.push({ id: part.therapistId, clinic: helperClinic, postTax: helperPostTax });
      } else if (part) {
        recipients[0] = { id: runner, clinic: clinicSharePaise, postTax: postTaxPaise };
      }
      for (const r of recipients) {
        if (r.id === billerId || (r.clinic <= 0 && r.postTax <= 0)) continue;
        movements.push({
          mechanism: 'package_attribution',
          visitId: g.id,
          fromTherapistId: billerId,
          toTherapistId: r.id,
          grossPaise: 0,
          clinicSharePaise: r.clinic,
          postTaxPaise: r.postTax,
        });
      }
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
