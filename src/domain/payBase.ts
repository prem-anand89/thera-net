import type { UUID, Visit } from './types';
import type { Paise } from './money';
import { roundToRupeeHalfUp } from './money';

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
 * Pure: callers fetch the visits and their package groups (reportService
 * via `repos.visits.listByPackageGroup`) and pass them in.
 */

export type Movement = {
  /** `line_share` is reserved for per-line revenue shares; nothing produces it yet. */
  mechanism: 'manual_split' | 'package_attribution' | 'line_share';
  /** The visit whose delivery earned the move (for packages: the session, not the billing visit). */
  visitId: UUID;
  fromTherapistId: UUID;
  toTherapistId: UUID;
  /** Bill-based amount moved. Package attribution moves none — it has never had a gross-level equivalent. */
  grossPaise: Paise;
  clinicSharePaise: Paise;
  postTaxPaise: Paise;
};

export interface PayBaseInput {
  /** The visits dated inside [from, to]. */
  visits: Visit[];
  /** Every package group any of `visits` belongs to — the FULL group, all dates. */
  packageGroups: Map<UUID, Visit[]>;
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

/**
 * How a package group's price divides per session. The "billing visit" is
 * the one carrying the package's price (everything else is logged at ₹0);
 * each per-session share is that visit's figure ÷ the DECLARED session
 * count, floored to whole rupees, so the share stays stable however many
 * sessions have been logged so far and whichever month is asking.
 */
export function packageSessionShares(group: Visit[]) {
  const packageTotal = group[0]?.packageTotal || group.length;
  const billingVisit = group.reduce(
    (max, g) => (g.actualBillPaise > max.actualBillPaise ? g : max),
    group[0]
  );
  const perSession = (paise: Paise): Paise => Math.floor(paise / 100 / packageTotal) * 100;
  return {
    billingVisit,
    packageTotal,
    postTaxPaise: perSession(billingVisit.postTaxPaise),
    clinicSharePaise: perSession(billingVisit.clinicSharePaise),
  };
}

/**
 * Every therapist-to-therapist movement for the [from, to] window:
 *
 * (1) `manual_split` — a visit's legacy Shared/Split: `sharedPct` of its
 * bill, clinic share and Post-Tax each move from the primary to the
 * assisting therapist, rounded half-up to the whole rupee per visit.
 *
 * (2) `package_attribution` — for every session of a multi-session package
 * whose own visitDate falls inside [from, to] and was run by a therapist
 * other than the biller, one per-session share (see packageSessionShares)
 * moves from the biller to that therapist. Settlement is scoped to the
 * window so a package spanning several months settles one month at a
 * time, and a closed month's figures never change when a later session is
 * logged. Any share not claimed this way — including sessions not yet
 * logged — stays with the biller; nothing is ever left unattributed.
 * Overlogging beyond the declared total can, in theory, give away more
 * than the billing visit's total — rare, self-correcting once the package
 * total is fixed; not worth guarding speculatively.
 */
export function attributionMovements(input: PayBaseInput): Movement[] {
  const { visits, packageGroups, from, to } = input;
  const movements: Movement[] = [];

  for (const v of visits) {
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
    const { billingVisit, postTaxPaise, clinicSharePaise } = packageSessionShares(group);
    if (postTaxPaise <= 0) continue;
    for (const g of group) {
      if (g.visitDate < from || g.visitDate > to) continue;
      if (g.id === billingVisit.id || g.therapistId === billingVisit.therapistId) continue;
      movements.push({
        mechanism: 'package_attribution',
        visitId: g.id,
        fromTherapistId: billingVisit.therapistId,
        toTherapistId: g.therapistId,
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
