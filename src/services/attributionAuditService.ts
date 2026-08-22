import type { UUID } from '@/domain/types';
import type { Paise } from '@/domain/money';
import { roundToRupeeHalfUp } from '@/domain/money';
import { monthDateRange, type FyMonth } from '@/domain/fiscalYear';
import type { Repos } from '@/repositories/types';

/**
 * One rupee movement from one therapist's row to another's, for a given
 * month — the per-transaction detail behind reportService's aggregate
 * Shared/Net figures. Exists so a disputed monthly number can be traced
 * back to the specific visit(s) that produced it.
 */
export interface AttributionEntry {
  mechanism: 'manual_split' | 'package_attribution';
  visitId: UUID;
  visitDate: string;
  patientId: UUID;
  fromTherapistId: UUID;
  toTherapistId: UUID;
  /** Gross (bill-based) amount moved — null for package attribution, which has no gross-level equivalent computed today. */
  grossPaise: Paise | null;
  postTaxPaise: Paise;
  packageGroupId: UUID | null;
}

/**
 * Per-transaction ledger for a month: every rupee that moved between
 * therapists via either manual Shared/Split or automatic package-session
 * attribution. Mirrors reportService.monthly's own two loops exactly (same
 * source visits, same in-window scoping for package attribution) so this
 * list always sums to the same deltas that produced that month's Net
 * figures — see reportService.ts for the aggregate versions of both loops.
 */
export function createAttributionAuditService(repos: Repos) {
  return {
    async monthly(clinicId: UUID, month: FyMonth): Promise<AttributionEntry[]> {
      const { from, to } = monthDateRange(month);
      const visits = await repos.visits.list({ clinicId, from, to });
      const entries: AttributionEntry[] = [];

      for (const v of visits) {
        if (!v.sharedTherapistId || !v.sharedPct) continue;
        entries.push({
          mechanism: 'manual_split',
          visitId: v.id,
          visitDate: v.visitDate,
          patientId: v.patientId,
          fromTherapistId: v.therapistId,
          toTherapistId: v.sharedTherapistId,
          grossPaise: roundToRupeeHalfUp((v.actualBillPaise * v.sharedPct) / 100),
          postTaxPaise: roundToRupeeHalfUp((v.postTaxPaise * v.sharedPct) / 100),
          packageGroupId: null,
        });
      }

      const packageGroupIds = new Set(
        visits.filter((v) => v.packageGroupId && (v.packageTotal ?? 1) > 1).map((v) => v.packageGroupId!)
      );
      await Promise.all(
        [...packageGroupIds].map(async (groupId) => {
          const group = await repos.visits.listByPackageGroup(groupId);
          const packageTotal = group[0]?.packageTotal || group.length;
          const billingVisit = group.reduce(
            (max, g) => (g.actualBillPaise > max.actualBillPaise ? g : max),
            group[0]
          );
          const perSessionShare = Math.floor(billingVisit.postTaxPaise / 100 / packageTotal) * 100;
          if (perSessionShare <= 0) return;
          for (const g of group) {
            if (g.visitDate < from || g.visitDate > to) continue;
            if (g.id === billingVisit.id || g.therapistId === billingVisit.therapistId) continue;
            entries.push({
              mechanism: 'package_attribution',
              visitId: g.id,
              visitDate: g.visitDate,
              patientId: g.patientId,
              fromTherapistId: billingVisit.therapistId,
              toTherapistId: g.therapistId,
              grossPaise: null,
              postTaxPaise: perSessionShare as Paise,
              packageGroupId: groupId,
            });
          }
        })
      );

      return entries.sort((a, b) => a.visitDate.localeCompare(b.visitDate));
    },
  };
}

export type AttributionAuditService = ReturnType<typeof createAttributionAuditService>;
