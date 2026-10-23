import { roundToRupeeHalfUp, type Paise } from '@/domain/money';
import type { UUID, Visit, VisitCredit, VisitItem } from '@/domain/types';
import { SHARE_MISSING, rebalanceCredits, type CreditShare } from '@/domain/visitLines';

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

export const BILL_BELOW_SHARES =
  'The bill is now lower than the shares. Recalculate from services or lower a share.';

/**
 * The shares the editor starts from: stored rows, else the old one-assistant split, else all to the
 * primary. The primary absorbs any difference between the bill and the other shares (their row is added
 * when missing), so a bill changed after a hand edit opens as a valid split. If that would leave the
 * primary below its floor (₹0, or the package money it holds) the stored rows are shown unchanged —
 * they no longer add up to the bill (`sharesTotalMismatch`) and the editor blocks Save.
 */
export function initialShares(
  visit: Pick<Visit, 'therapistId' | 'actualBillPaise' | 'sharedTherapistId' | 'sharedPct'>,
  credits: VisitCredit[],
  locked: ShareContext['locked'] = null
): CreditShare[] {
  const live = credits.filter((c) => !c.deleted);
  if (live.length > 0) {
    const stored = live.map((c) => ({ therapistId: c.therapistId, amountPaise: c.amountPaise }));
    stored.sort((a, b) => Number(b.therapistId === visit.therapistId) - Number(a.therapistId === visit.therapistId));
    const others = stored.filter((r) => r.therapistId !== visit.therapistId);
    const primaryAmount = visit.actualBillPaise - others.reduce((s, r) => s + r.amountPaise, 0);
    const floor = locked && locked.therapistId === visit.therapistId ? locked.amountPaise : 0;
    if (primaryAmount < floor) return stored;
    return [{ therapistId: visit.therapistId, amountPaise: primaryAmount }, ...others];
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

/** True when the rows do not add up to the bill (only possible for stored rows that could not be fixed). */
export function sharesTotalMismatch(rows: CreditShare[], billPaise: Paise): boolean {
  return rows.reduce((s, r) => s + r.amountPaise, 0) !== billPaise;
}

/**
 * Whether to offer "Update shares from services?". Only for hand-edited ('manual') shares on a visit that
 * has services, and only when the services or bill changed after the shares were last edited — a line
 * saved later than the newest share row, or stored rows that no longer add up to the bill. A hand edit
 * alone never triggers it (recalculating would erase a deliberate split), nor does a visit without lines.
 */
export function sharesAreOutdated(
  visit: Pick<Visit, 'actualBillPaise' | 'creditsMode'>,
  items: VisitItem[],
  credits: VisitCredit[]
): boolean {
  if ((visit.creditsMode ?? 'auto') !== 'manual') return false;
  const lines = items.filter((i) => !i.deleted);
  if (lines.length === 0) return false;
  const shares = credits.filter((c) => !c.deleted);
  if (shares.reduce((s, c) => s + c.amountPaise, 0) !== visit.actualBillPaise) return true;
  const newest = (rows: { updatedAt: string }[]) => rows.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), '');
  return newest(lines) > newest(shares);
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

/**
 * Drops a therapist's row, their share going back to the primary (whose row is created if it is missing).
 * The primary and the package holder stay.
 */
export function removeShareRow(rows: CreditShare[], therapistId: UUID, ctx: ShareContext): CreditShare[] {
  if (therapistId === ctx.primaryId || ctx.locked?.therapistId === therapistId) return rows;
  const gone = rows.find((r) => r.therapistId === therapistId);
  if (!gone) return rows;
  const kept = rows.filter((r) => r.therapistId !== therapistId);
  if (!kept.some((r) => r.therapistId === ctx.primaryId)) kept.unshift({ therapistId: ctx.primaryId, amountPaise: 0 });
  return kept.map((r) => (r.therapistId === ctx.primaryId ? { ...r, amountPaise: r.amountPaise + gone.amountPaise } : r));
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
