import type { UUID, Visit } from '@/domain/types';
import type { Paise } from '@/domain/money';
import { paiseToRupees, roundToRupeeHalfUp } from '@/domain/money';
import { monthDateRange, monthName, type FyMonth } from '@/domain/fiscalYear';
import type { Repos } from '@/repositories/types';

export interface TherapistMonthRow {
  therapistId: UUID | 'total';
  therapistName: string;
  billPaise: Paise;
  bmSharePaise: Paise;
  tdsPaise: Paise;
  postTaxPaise: Paise;
  hvPaise: Paise;
  /** Net catalog-vs-actual variance — "revenue lost to discounts" when negative */
  adjustmentPaise: Paise;
  /**
   * Internal therapist split: net billed-rupees credited to (+) or given up
   * by (−) this therapist via same-visit splits. Nets to zero on the Total
   * row — purely an internal redistribution, never touches billed totals.
   */
  sharedPaise: Paise;
  /**
   * Post-Tax BM after splits AND package-session attribution — this
   * therapist's actual take-home/credit figure, not just what happened to
   * be billed under their name. Two adjustments feed in, both applied to
   * Post-Tax BM directly (not derived from sharedPaise, a different base):
   * (1) same-visit manual Shared/Split — a share given to/from a named
   * assisting therapist; (2) automatic package attribution — a package's
   * full price is billed on one session's visit (the "billing visit"),
   * with every other session logged separately at ₹0 so it isn't
   * double-billed, which otherwise credits 100% of a multi-session
   * package to whichever therapist logged the billing visit even when a
   * colleague delivered other sessions. For every OTHER session in the
   * group logged by a DIFFERENT therapist, a fixed per-session share
   * (billing visit's Post-Tax BM ÷ declared session count, whole rupees)
   * moves from the biller to that therapist, but only for sessions that
   * fall inside THIS report's own month — a package spanning several
   * months settles incrementally, one month at a time, so a past month's
   * numbers never change when a later month's session is logged (see
   * packageAttributionDeltas). Everything not explicitly claimed this
   * way in the CURRENT period — including the share reserved for
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
  visitCount: number;
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
 * Per-therapist Post-Tax BM deltas from automatic package-session
 * attribution (see TherapistMonthRow.netPostTaxPaise). For each
 * multi-session package group, the "billing visit" (the one carrying the
 * package's price — everything else is logged at ₹0) defines a fixed
 * `perSessionShare = floor(billingVisit.postTaxPaise / packageTotal)`,
 * whole rupees, using the package's DECLARED session count so the share
 * stays stable regardless of how many sessions have been logged so far —
 * and regardless of which month's report is asking, since it's derived
 * from the full group via `listByPackageGroup` (date-range-agnostic).
 *
 * Settlement itself, though, is scoped to THIS report's [from,to] window:
 * only sibling sessions whose own visitDate falls inside it move money
 * this call. A package spanning several months settles incrementally —
 * one month's sessions at a time — rather than re-applying every session's
 * share retroactively each time a later month's report touches the same
 * group. This means a past month's report is immutable to later events:
 * re-running `monthly()` for a month that has already "closed" always
 * reproduces the same numbers, because no future visit's date can ever
 * fall inside a past window. For every in-window session whose therapist
 * differs from the billing visit's therapist, one `perSessionShare` moves
 * from the biller to that therapist THIS period; sessions the biller
 * logged themselves need no delta. Deltas always sum to zero within a
 * single call (whatever's given away this period is exactly what's
 * subtracted from the biller's row this period), so `total.netPostTaxPaise`
 * is untouched and nothing is ever left unattributed — a share for a
 * session that hasn't been logged yet (in any month) simply stays with the
 * biller instead of vanishing. The biller may end up with a zero-visit row
 * showing a negative Net for a period in which a colleague ran a session
 * of their package but they personally saw no one — that's the debit
 * actually landing, not a bug; the caller (`monthly()`) is responsible for
 * creating that row even though the biller has no visit this period.
 */
async function packageAttributionDeltas(
  visits: Visit[],
  repos: Pick<Repos, 'visits'>,
  from: string,
  to: string
): Promise<Map<UUID, Paise>> {
  const packageGroupIds = new Set(
    visits.filter((v) => v.packageGroupId && (v.packageTotal ?? 1) > 1).map((v) => v.packageGroupId!)
  );
  const deltas = new Map<UUID, Paise>();
  const add = (id: UUID, amt: number) => deltas.set(id, ((deltas.get(id) ?? 0) + amt) as Paise);
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
      // Overlogging beyond the declared packageTotal can, in theory, give
      // away more than the billing visit's total — rare, self-correcting
      // once the package total is fixed; not worth guarding speculatively.
      let givenAway = 0;
      for (const g of group) {
        if (g.visitDate < from || g.visitDate > to) continue;
        if (g.id === billingVisit.id || g.therapistId === billingVisit.therapistId) continue;
        add(g.therapistId, perSessionShare);
        givenAway += perSessionShare;
      }
      if (givenAway > 0) add(billingVisit.therapistId, -givenAway);
    })
  );
  return deltas;
}

/**
 * Monthly rollup, computed from stored visit records — never entered by hand
 * (spec §5.2). Because splits were rounded once per visit at billing time,
 * these sums always reconcile with each other.
 */
export function createReportService(repos: Repos) {
  return {
    async monthly(clinicId: UUID, month: FyMonth): Promise<MonthlyReport> {
      const { from, to } = monthDateRange(month);
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
        bmSharePaise: 0,
        tdsPaise: 0,
        postTaxPaise: 0,
        hvPaise: 0,
        adjustmentPaise: 0,
        sharedPaise: 0,
        netPostTaxPaise: 0,
        visitCount: 0,
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
          r.bmSharePaise += v.bmSharePaise;
          r.tdsPaise += v.tdsPaise;
          r.postTaxPaise += v.postTaxPaise;
          r.hvPaise += v.hvPaise;
          r.adjustmentPaise += v.adjustmentPaise;
          r.netPostTaxPaise += v.postTaxPaise;
          r.visitCount += 1;
        }
        if (!patientsByTherapist.has(v.therapistId)) patientsByTherapist.set(v.therapistId, new Set());
        patientsByTherapist.get(v.therapistId)!.add(v.patientId);
        allPatients.add(v.patientId);
      }
      for (const [id, set] of patientsByTherapist) rowsById.get(id)!.uniquePatients = set.size;
      total.uniquePatients = allPatients.size;

      // Internal therapist splits: move a share of the billed amount (Shared)
      // and, separately, of Post-Tax BM (Net) from the primary to an
      // assisting therapist. Both round to whole rupees like every other
      // money figure in the app; both net to zero, so no billed total above
      // is affected — this is attribution only.
      for (const v of visits) {
        if (!v.sharedTherapistId || !v.sharedPct) continue;
        const sharedAmt = roundToRupeeHalfUp((v.actualBillPaise * v.sharedPct) / 100);
        rowFor(v.therapistId).sharedPaise -= sharedAmt;
        rowFor(v.sharedTherapistId).sharedPaise += sharedAmt;
        // total.sharedPaise stays 0 — the − and + are equal and opposite

        const sharedPostTaxAmt = roundToRupeeHalfUp((v.postTaxPaise * v.sharedPct) / 100);
        rowFor(v.therapistId).netPostTaxPaise -= sharedPostTaxAmt;
        rowFor(v.sharedTherapistId).netPostTaxPaise += sharedPostTaxAmt;
        // total.netPostTaxPaise stays equal to total.postTaxPaise
      }

      // Automatic package-session attribution — deltas net to zero per
      // call, so `total` is never touched; attribution only redistributes
      // which row a rupee counts under. Unlike the manual split above, this
      // CAN create a row for a therapist with no visit of their own this
      // period — e.g. the biller of a package billed last month still gets
      // a (zero-visit, negative-Net) row this month if a colleague logs a
      // session of that package now. Dropping that row instead would
      // silently overcredit the colleague without debiting anyone, which is
      // exactly the bug this replaced (`rowFor` forces the row into
      // existence; `rowsById.get` alone would not).
      const packageDeltas = await packageAttributionDeltas(visits, repos, from, to);
      for (const [therapistId, delta] of packageDeltas) {
        rowFor(therapistId).netPostTaxPaise += delta;
      }

      const rows = [...rowsById.values()].sort((a, b) =>
        a.therapistName.localeCompare(b.therapistName)
      );
      return {
        month,
        title: `${monthName(month.month)} ${month.year}`,
        rows,
        total,
      };
    },

    toCsv(
      report: MonthlyReport,
      opts: {
        labels?: { own: string; partner: string };
        hospitalSplit?: boolean;
        therapistSplit?: boolean;
      } = {}
    ): string {
      const labels = opts.labels ?? { own: 'Clinic', partner: 'Partner' };
      const hospitalSplit = opts.hospitalSplit ?? true;
      const therapistSplit = opts.therapistSplit ?? true;

      const header = [
        'Therapist',
        'Bill Amount',
        ...(hospitalSplit
          ? [`${labels.own} Share`, 'TDS Deducted', `Post Tax ${labels.own}`, `${labels.partner} Share`]
          : []),
        ...(therapistSplit ? ['Shared'] : []),
        'Net',
        'Visits',
        'Patients',
      ];
      const line = (r: TherapistMonthRow) => [
        r.therapistName,
        paiseToRupees(r.billPaise),
        ...(hospitalSplit
          ? [
              paiseToRupees(r.bmSharePaise),
              paiseToRupees(r.tdsPaise),
              paiseToRupees(r.postTaxPaise),
              paiseToRupees(r.hvPaise),
            ]
          : []),
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
