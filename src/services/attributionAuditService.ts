import type { UUID, Visit } from '@/domain/types';
import type { Paise } from '@/domain/money';
import { attributionMovements, packageSessionShares } from '@/domain/payBase';
import { monthDateRange, type FyMonth } from '@/domain/fiscalYear';
import type { Repos } from '@/repositories/types';
import { loadPayBaseInput } from './reportService';

/**
 * One rupee movement from one therapist's row to another's, for a given
 * month — the per-transaction detail behind reportService's aggregate
 * Shared/Net figures. Exists so a disputed monthly number can be traced
 * back to the specific visit(s) that produced it.
 */
export interface AttributionEntry {
  /** `line_share`: a visit's revenue share (VisitCredit row); `manual_split`: the legacy sharedPct on a visit without shares. */
  mechanism: 'manual_split' | 'package_attribution' | 'line_share';
  visitId: UUID;
  visitDate: string;
  patientId: UUID;
  fromTherapistId: UUID;
  toTherapistId: UUID;
  /** Gross (bill-based) amount moved — null for package attribution, which has no gross-level equivalent computed today. */
  grossPaise: Paise | null;
  postTaxPaise: Paise;
  packageGroupId: UUID | null;
  /**
   * What the moved amount is a share OF — without this, a bare "₹500"
   * moved between two names is unverifiable. `manual_split`: the full
   * visit bill and the % applied to it (`grossPaise` is just that %
   * pre-computed). `line_share`: the full visit bill (`grossPaise` is the
   * therapist's ₹ share of it; no %). `package_attribution`: the package's
   * price (its package line's net, or the billing visit's bill for visits
   * without lines), the package's declared session count, and which
   * session number this row's visit is — so "₹500" reads as "1 of 3
   * sessions of a ₹1,500 package," not an unexplained figure.
   */
  sharedPct: number | null;
  visitBillPaise: Paise | null;
  packageTotalPaise: Paise | null;
  packageSessionCount: number | null;
  sessionIndex: number | null;
  /**
   * `line_share` only: the visit's stored shares didn't add up to its bill,
   * so this entry comes from shares recomputed from its service lines.
   * Always false for the other mechanisms.
   */
  repaired: boolean;
}

/**
 * Per-transaction ledger for a month: every rupee that moved between
 * therapists via revenue shares (or the legacy Shared/Split) or automatic
 * package-session attribution. Built from the very same payBase input and
 * movements reportService aggregates (same source visits, lines and shares,
 * same in-window scoping for package attribution), so this list always sums
 * to the same deltas that produced that month's Net figures — see
 * domain/payBase.ts.
 */
export function createAttributionAuditService(repos: Repos) {
  return {
    async monthly(clinicId: UUID, month: FyMonth): Promise<AttributionEntry[]> {
      const { from, to } = monthDateRange(month);
      const visits = await repos.visits.list({ clinicId, from, to });
      const input = await loadPayBaseInput(clinicId, visits, from, to, repos);
      const visitById = new Map<UUID, Visit>(visits.map((v) => [v.id, v]));
      for (const group of input.packageGroups.values()) for (const g of group) visitById.set(g.id, g);

      const entries: AttributionEntry[] = attributionMovements(input).map((m): AttributionEntry => {
        const v = visitById.get(m.visitId)!;
        const common = {
          visitId: m.visitId,
          visitDate: v.visitDate,
          patientId: v.patientId,
          fromTherapistId: m.fromTherapistId,
          toTherapistId: m.toTherapistId,
          postTaxPaise: m.postTaxPaise,
          packageTotalPaise: null,
          packageSessionCount: null,
          sessionIndex: null,
        };
        switch (m.mechanism) {
          case 'manual_split':
            return {
              ...common,
              mechanism: 'manual_split',
              grossPaise: m.grossPaise,
              packageGroupId: null,
              sharedPct: v.sharedPct ?? null,
              visitBillPaise: v.actualBillPaise,
              repaired: false,
            };
          case 'line_share':
            return {
              ...common,
              mechanism: 'line_share',
              grossPaise: m.grossPaise,
              packageGroupId: null,
              sharedPct: null,
              visitBillPaise: v.actualBillPaise,
              repaired: m.repaired ?? false,
            };
          case 'package_attribution': {
            const { packagePricePaise, packageTotal } = packageSessionShares(
              input.packageGroups.get(v.packageGroupId!)!,
              input.items,
              input.splitEnabled
            );
            return {
              ...common,
              mechanism: 'package_attribution',
              grossPaise: null,
              packageGroupId: v.packageGroupId,
              sharedPct: null,
              visitBillPaise: null,
              packageTotalPaise: packagePricePaise,
              packageSessionCount: packageTotal,
              sessionIndex: v.sessionIndex,
              repaired: false,
            };
          }
          default: {
            const unhandled: never = m.mechanism;
            throw new Error(`Unknown attribution mechanism: ${String(unhandled)}`);
          }
        }
      });

      return entries.sort((a, b) => a.visitDate.localeCompare(b.visitDate));
    },
  };
}

export type AttributionAuditService = ReturnType<typeof createAttributionAuditService>;
