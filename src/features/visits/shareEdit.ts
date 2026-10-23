import { roundToRupeeHalfUp, type Paise } from '@/domain/money';
import type { UUID, Visit, VisitCredit, VisitItem } from '@/domain/types';
import {
  SHARE_MISSING,
  autoCredits,
  deliverer,
  lineNets,
  rebalanceCredits,
  type CreditShare,
} from '@/domain/visitLines';

/**
 * The share editor's logic, kept out of the component: which row holds package money, whether the
 * stored shares have fallen behind the services, and every hand edit (through `rebalanceCredits`, the
 * one place the rules live). Pure.
 */

export interface ShareContext {
  primaryId: UUID;
  billPaise: Paise;
  /** The row holding package money — it may never go below that amount. */
  locked: { therapistId: UUID; amountPaise: Paise } | null;
}

/** Who holds the package line's money and how much: its deliverer (the primary when split is off). */
export function packageLock(
  visit: Pick<Visit, 'therapistId' | 'actualBillPaise'>,
  items: VisitItem[],
  splitEnabled: boolean
): ShareContext['locked'] {
  const line = items.find((l) => !l.deleted && l.isPackageLine);
  if (!line) return null;
  return {
    therapistId: splitEnabled ? deliverer(line, visit.therapistId) : visit.therapistId,
    amountPaise: lineNets(items, visit.actualBillPaise).get(line.id) ?? 0,
  };
}

/** The shares the editor starts from: stored rows, else the old one-assistant split, else all to the primary. */
export function initialShares(
  visit: Pick<Visit, 'therapistId' | 'actualBillPaise' | 'sharedTherapistId' | 'sharedPct'>,
  credits: VisitCredit[]
): CreditShare[] {
  const live = credits.filter((c) => !c.deleted);
  if (live.length > 0) {
    const rows = live.map((c) => ({ therapistId: c.therapistId, amountPaise: c.amountPaise }));
    rows.sort((a, b) => Number(b.therapistId === visit.therapistId) - Number(a.therapistId === visit.therapistId));
    return rows;
  }
  if (visit.sharedTherapistId && visit.sharedPct) {
    const shared = roundToRupeeHalfUp((visit.actualBillPaise * visit.sharedPct) / 100);
    return [
      { therapistId: visit.therapistId, amountPaise: visit.actualBillPaise - shared },
      { therapistId: visit.sharedTherapistId, amountPaise: shared },
    ];
  }
  return [{ therapistId: visit.therapistId, amountPaise: visit.actualBillPaise }];
}

/** Hand-edited shares that no longer match what the services would give (so offer "Recalculate"). */
export function sharesAreOutdated(
  visit: Pick<Visit, 'therapistId' | 'actualBillPaise' | 'creditsMode'>,
  items: VisitItem[],
  credits: VisitCredit[],
  splitEnabled: boolean
): boolean {
  if ((visit.creditsMode ?? 'auto') !== 'manual') return false;
  const toMap = (rows: CreditShare[]) =>
    new Map(rows.filter((r) => r.amountPaise !== 0).map((r) => [r.therapistId, r.amountPaise]));
  const auto = toMap(autoCredits(items, visit.therapistId, visit.actualBillPaise, { splitEnabled }));
  const stored = toMap(
    credits.filter((c) => !c.deleted).map((c) => ({ therapistId: c.therapistId, amountPaise: c.amountPaise }))
  );
  if (auto.size !== stored.size) return true;
  for (const [id, amount] of auto) if (stored.get(id) !== amount) return true;
  return false;
}

/**
 * One typed edit to a non-primary therapist's ₹ or %. Always returns usable rows: the new ones, or the
 * unchanged ones with `error` set when the edit isn't allowed (the editor shows it and blocks Save).
 */
export function applyShareEdit(
  rows: CreditShare[],
  edit: { therapistId: UUID; rupees?: string; pct?: string },
  ctx: ShareContext
): { rows: CreditShare[]; error: string | null } {
  const text = (edit.rupees ?? edit.pct ?? '').trim();
  const n = Number(text);
  if (text === '' || !Number.isFinite(n)) return { rows, error: SHARE_MISSING };
  try {
    const next = rebalanceCredits(
      rows,
      edit.rupees !== undefined
        ? { therapistId: edit.therapistId, amountPaise: Math.round(n * 100) }
        : { therapistId: edit.therapistId, pct: n },
      ctx.primaryId,
      ctx.billPaise,
      ctx.locked
    );
    return { rows: next, error: null };
  } catch (e) {
    return { rows, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Adds a therapist at ₹0 (a no-op if they already have a row). */
export function addShareRow(rows: CreditShare[], therapistId: UUID, ctx: ShareContext): CreditShare[] {
  if (rows.some((r) => r.therapistId === therapistId)) return rows;
  try {
    return rebalanceCredits(rows, { therapistId, amountPaise: 0 }, ctx.primaryId, ctx.billPaise, ctx.locked);
  } catch {
    return rows;
  }
}

/** Drops a therapist's row, their share going back to the primary. The primary and the package holder stay. */
export function removeShareRow(rows: CreditShare[], therapistId: UUID, ctx: ShareContext): CreditShare[] {
  if (therapistId === ctx.primaryId || ctx.locked?.therapistId === therapistId) return rows;
  const gone = rows.find((r) => r.therapistId === therapistId);
  if (!gone) return rows;
  return rows
    .filter((r) => r.therapistId !== therapistId)
    .map((r) => (r.therapistId === ctx.primaryId ? { ...r, amountPaise: r.amountPaise + gone.amountPaise } : r));
}

/** Who last changed the shares, and when (name null when the login can't be matched to a therapist). */
export function lastEditedBy(
  credits: VisitCredit[],
  people: { userId?: string | null; name: string }[]
): { name: string | null; at: string } | null {
  const live = credits.filter((c) => !c.deleted);
  if (live.length === 0) return null;
  const latest = live.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
  const name = latest.updatedBy ? (people.find((p) => p.userId === latest.updatedBy)?.name ?? null) : null;
  return { name, at: latest.updatedAt };
}
