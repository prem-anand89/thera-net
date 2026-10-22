import type { UUID, Visit } from '@/domain/types';
import type { Paise } from '@/domain/money';
import { paiseToRupees } from '@/domain/money';
import { attributablePackageGroupIds, payBaseByTherapist, type PayBaseInput } from '@/domain/payBase';
import { deliverer } from '@/domain/visitLines';
import { monthDateRange, monthName, type FyMonth } from '@/domain/fiscalYear';
import type { Repos } from '@/repositories/types';

export interface TherapistMonthRow {
  therapistId: UUID | 'total';
  therapistName: string;
  billPaise: Paise;
  clinicSharePaise: Paise;
  tdsPaise: Paise;
  postTaxPaise: Paise;
  partnerSharePaise: Paise;
  /** Net catalog-vs-actual variance — "revenue lost to discounts" when negative */
  adjustmentPaise: Paise;
  /**
   * Internal therapist split: net billed-rupees credited to (+) or given up
   * by (−) this therapist via same-visit splits — a visit's revenue shares
   * (VisitCredit rows), or the legacy sharedPct for visits without shares.
   * Nets to zero on the Total
   * row — purely an internal redistribution, never touches billed totals.
   */
  sharedPaise: Paise;
  /**
   * Post-Tax after splits AND package-session attribution — this
   * therapist's actual take-home/credit figure, not just what happened to
   * be billed under their name. Two adjustments feed in, both applied to
   * Post-Tax directly (not derived from sharedPaise, a different base):
   * (1) same-visit revenue shares — a share given to/from another
   * therapist on the visit (VisitCredit rows, each therapist's share of
   * the bill ÷ bill × Post-Tax; or the legacy sharedPct); (2) automatic package attribution — a package's
   * full price is billed on one session's visit (the "billing visit"),
   * with every other session logged separately at ₹0 so it isn't
   * double-billed, which otherwise credits 100% of a multi-session
   * package to whichever therapist logged the billing visit even when a
   * colleague delivered other sessions. For every OTHER session in the
   * group logged by a DIFFERENT therapist, a fixed per-session share
   * (the package's Post-Tax — its package line's share of the billing
   * visit, or the whole visit for visits without lines — ÷ declared
   * session count, whole rupees)
   * moves from the biller to that therapist, but only for sessions that
   * fall inside THIS report's own month — a package spanning several
   * months settles incrementally, one month at a time, so a past month's
   * numbers never change when a later month's session is logged (see
   * attributionMovements in domain/payBase). Everything not explicitly
   * claimed this way in the CURRENT period — including the share reserved for
   * sessions not yet logged anywhere — stays with the biller; nothing is
   * ever left unattributed. `total.netPostTaxPaise` always equals
   * `total.postTaxPaise` unchanged, and `sum(rows.netPostTaxPaise)`
   * always equals `total.netPostTaxPaise` — attribution only
   * redistributes which ROW a rupee counts under, never what the
   * clinic-wide total claims, and never drops a rupee. A row can appear
   * with zero visits and a negative Net when its therapist billed a
   * package but a colleague ran this period's session of it.
   */
  netPostTaxPaise: Paise;
  /**
   * Clinic share after the same splits and package attribution as
   * netPostTaxPaise (same pct / per-session ratio, applied to the clinic
   * share instead) — the base payroll pays from. Same invariants: the
   * Total row equals `clinicSharePaise`, rows sum to it.
   */
  netClinicSharePaise: Paise;
  /** Visits this therapist was the primary on. */
  visitCount: number;
  /**
   * Visits this therapist delivered at least one service line on (visits without lines: as primary), each
   * visit once per therapist — so a primary who also delivers counts once. The Total row is the number of
   * visits (no double count).
   */
  patientsTreated: number;
  /** Visits this therapist delivered a line on without being the primary. Always 0 on the Total row. */
  assistedVisitCount: number;
  /** Number of sessions represented by the revenue billed this month (e.g., a 5-session package counts as 5, not 1) */
  billedSessionCount: number;
  /** COUNT(DISTINCT mrno) — unique patients, not visit count (spec §5.2) */
  uniquePatients: number;
}

export interface MonthlyReport {
  month: FyMonth;
  title: string;
  rows: TherapistMonthRow[];
  total: TherapistMonthRow;
}

/**
 * Fetch the FULL package group (every date) for each multi-session package
 * any of `visits` belongs to — the input payBase needs to size a
 * per-session share independently of which window is asking. Kept here,
 * not in payBase, so the domain function stays pure.
 */
export async function loadPackageGroups(
  visits: Visit[],
  repos: Pick<Repos, 'visits'>
): Promise<Map<UUID, Visit[]>> {
  const ids = attributablePackageGroupIds(visits);
  const groups = await Promise.all(ids.map((id) => repos.visits.listByPackageGroup(id)));
  return new Map(ids.map((id, i) => [id, groups[i]]));
}

/**
 * Everything payBase needs for a window's visits: their package groups, the
 * service lines and revenue shares of every visit involved (the window's
 * and the groups', one repo call per table), and the clinic's therapist-split
 * setting (default on). Shared by reportService and the attribution audit
 * so both always compute from identical input.
 */
export async function loadPayBaseInput(
  clinicId: UUID,
  visits: Visit[],
  from: string,
  to: string,
  repos: Pick<Repos, 'visits' | 'visitItems' | 'visitCredits' | 'clinics'>
): Promise<PayBaseInput> {
  const packageGroups = await loadPackageGroups(visits, repos);
  const visitIds = [...new Set([...visits, ...[...packageGroups.values()].flat()].map((v) => v.id))];
  const [items, credits, clinic] = await Promise.all([
    repos.visitItems.listByVisitIds(visitIds),
    repos.visitCredits.listByVisitIds(visitIds),
    repos.clinics.get(clinicId),
  ]);
  const byVisit = <T extends { visitId: UUID }>(rows: T[]) => {
    const map = new Map<UUID, T[]>();
    for (const r of rows) {
      const list = map.get(r.visitId);
      if (list) list.push(r);
      else map.set(r.visitId, [r]);
    }
    return map;
  };
  return {
    visits,
    packageGroups,
    items: byVisit(items),
    credits: byVisit(credits),
    splitEnabled: clinic?.enableTherapistSplit ?? true,
    from,
    to,
  };
}

/**
 * Monthly rollup, computed from stored visit records — never entered by hand
 * (spec §5.2). Because splits were rounded once per visit at billing time,
 * these sums always reconcile with each other.
 */
export function createReportService(repos: Repos) {
  /** The same billed/post-tax/split rollup `monthly` produces, for an
   *  arbitrary date range rather than a whole calendar month — used by
   *  comparison modes that need a non-month-aligned range (e.g. "the same
   *  elapsed days last month" for a fair month-to-date comparison). Shares
   *  every bit of split/package-attribution logic with `monthly` so the
   *  numbers stay reconcilable with it; only the month-shaped `month`/
   *  `title` fields are omitted since a custom range isn't one calendar
   *  month. */
  async function totalsForRange(
    clinicId: UUID,
    from: string,
    to: string
  ): Promise<Pick<MonthlyReport, 'rows' | 'total'>> {
      const [visits, therapists] = await Promise.all([
        repos.visits.list({ clinicId, from, to }),
        repos.therapists.list(clinicId, true),
      ]);
      const therapistName = new Map(therapists.map((t) => [t.id, t.name]));

      const rowsById = new Map<string, TherapistMonthRow>();
      const patientsByTherapist = new Map<string, Set<string>>();
      const allPatients = new Set<string>();

      const blank = (id: UUID | 'total', name: string): TherapistMonthRow => ({
        therapistId: id,
        therapistName: name,
        billPaise: 0,
        clinicSharePaise: 0,
        tdsPaise: 0,
        postTaxPaise: 0,
        partnerSharePaise: 0,
        adjustmentPaise: 0,
        sharedPaise: 0,
        netClinicSharePaise: 0,
        netPostTaxPaise: 0,
        visitCount: 0,
        patientsTreated: 0,
        assistedVisitCount: 0,
        billedSessionCount: 0,
        uniquePatients: 0,
      });

      const rowFor = (id: UUID): TherapistMonthRow =>
        rowsById.get(id) ??
        rowsById.set(id, blank(id, therapistName.get(id) ?? 'Unknown')).get(id)!;

      const total = blank('total', 'Total');
      for (const v of visits) {
        const row = rowFor(v.therapistId);
        for (const r of [row, total]) {
          r.billPaise += v.actualBillPaise;
          r.clinicSharePaise += v.clinicSharePaise;
          r.tdsPaise += v.tdsPaise;
          r.postTaxPaise += v.postTaxPaise;
          r.partnerSharePaise += v.partnerSharePaise;
          r.adjustmentPaise += v.adjustmentPaise;
          r.netClinicSharePaise += v.clinicSharePaise;
          r.netPostTaxPaise += v.postTaxPaise;
          r.visitCount += 1;
          
          // Only add to billedSessionCount if this visit actually generated the revenue
          // (continuation sessions are logged at ₹0, so they don't count here).
          // If a visit was 100% discounted (₹0) and not a package, it still counts as 1.
          if (v.actualBillPaise > 0 || !v.packageTotal) {
            r.billedSessionCount += v.packageTotal ?? 1;
          }
        }
        if (!patientsByTherapist.has(v.therapistId)) patientsByTherapist.set(v.therapistId, new Set());
        patientsByTherapist.get(v.therapistId)!.add(v.patientId);
        allPatients.add(v.patientId);
      }
      for (const [id, set] of patientsByTherapist) rowsById.get(id)!.uniquePatients = set.size;
      total.uniquePatients = allPatients.size;

      // Internal therapist splits and automatic package-session attribution
      // (see TherapistMonthRow.netPostTaxPaise) — both come from payBase,
      // the one place therapist money is decided. Movements are equal and
      // opposite, so `total` is never touched; they only redistribute which
      // row a rupee counts under. This CAN create a row for a therapist with
      // no visit of their own this period — an assist-only therapist, or
      // the biller of a package billed last month whose colleague logs a
      // session now (a zero-visit, negative-Net row). Dropping that row
      // instead would silently overcredit the colleague without debiting
      // anyone (`rowFor` forces the row into existence; `rowsById.get`
      // alone would not). Package attribution moves no gross, so
      // sharedPaise is exactly the revenue-share (or legacy split) movement.
      const payBaseInput = await loadPayBaseInput(clinicId, visits, from, to, repos);
      const payBase = payBaseByTherapist(payBaseInput);
      for (const [therapistId, b] of payBase) {
        const row = rowFor(therapistId);
        row.sharedPaise = b.grossPaise - row.billPaise;
        row.netClinicSharePaise = b.clinicSharePaise;
        row.netPostTaxPaise = b.postTaxPaise;
      }

      // Patients treated / assisted visits, from the same service lines: each visit counts once per therapist
      // who delivered a line on it (visits without lines: the primary; an assistant only shows where they have
      // a row, i.e. split on), and the Total is just the visit count.
      for (const v of visits) {
        const live = (payBaseInput.items.get(v.id) ?? []).filter((i) => !i.deleted);
        const treated = new Set<UUID>(live.length > 0 ? live.map((i) => deliverer(i, v.therapistId)) : [v.therapistId]);
        for (const id of treated) {
          // An assistant with no row of their own (therapist split off: all money stays with the primary)
          // is not listed; the primary always has one from the loop above.
          const row = rowsById.get(id);
          if (!row) continue;
          row.patientsTreated += 1;
          if (id !== v.therapistId) row.assistedVisitCount += 1;
        }
      }
      total.patientsTreated = visits.length;

      const rows = [...rowsById.values()].sort((a, b) =>
        a.therapistName.localeCompare(b.therapistName)
      );
      return { rows, total };
  }

  return {
    async monthly(clinicId: UUID, month: FyMonth): Promise<MonthlyReport> {
      const { from, to } = monthDateRange(month);
      const { rows, total } = await totalsForRange(clinicId, from, to);
      return {
        month,
        title: `${monthName(month.month)} ${month.year}`,
        rows,
        total,
      };
    },

    /** For comparison modes needing a non-month-aligned range (e.g. Pacing's
     *  "same elapsed days last month"). Returns just the totals — no
     *  `month`/`title`, since a custom range isn't one calendar month. */
    totalsForRange,

    toCsv(
      report: MonthlyReport,
      opts: {
        labels?: { own: string; partner: string };
        partnerSplit?: boolean;
        /** At 0% TDS nothing is actually withheld, so Post Tax {own} would
         *  just repeat {own} Share — defaults to `partnerSplit` for
         *  backward compatibility; pass false to drop the column. */
        showPostTax?: boolean;
        therapistSplit?: boolean;
      } = {}
    ): string {
      const labels = opts.labels ?? { own: 'Clinic', partner: 'Partner' };
      const partnerSplit = opts.partnerSplit ?? true;
      const showPostTax = opts.showPostTax ?? partnerSplit;
      const therapistSplit = opts.therapistSplit ?? true;

      const header = [
        'Therapist',
        'Bill Amount',
        ...(partnerSplit ? [`${labels.own} Share`, 'TDS Deducted'] : []),
        ...(showPostTax ? [`Post Tax ${labels.own}`] : []),
        ...(partnerSplit ? [`${labels.partner} Share`] : []),
        ...(therapistSplit ? ['Shared'] : []),
        'Net',
        'Visits',
        'Patients',
      ];
      const line = (r: TherapistMonthRow) => [
        r.therapistName,
        paiseToRupees(r.billPaise),
        ...(partnerSplit ? [paiseToRupees(r.clinicSharePaise), paiseToRupees(r.tdsPaise)] : []),
        ...(showPostTax ? [paiseToRupees(r.postTaxPaise)] : []),
        ...(partnerSplit ? [paiseToRupees(r.partnerSharePaise)] : []),
        ...(therapistSplit ? [paiseToRupees(r.sharedPaise)] : []),
        paiseToRupees(r.netPostTaxPaise),
        r.visitCount,
        r.uniquePatients,
      ];
      return [header, ...report.rows.map(line), line(report.total)]
        .map((cells) => cells.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(','))
        .join('\n');
    },
  };
}
