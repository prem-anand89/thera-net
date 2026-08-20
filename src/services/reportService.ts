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
   * Post-Tax BM after splits: this therapist's own Post-Tax BM, minus what
   * they gave away and plus what they received via same-visit splits — the
   * actual take-home figure. Splits are applied to Post-Tax BM directly, not
   * derived from sharedPaise (which is a share of the billed amount, a
   * different base). Total always equals total.postTaxPaise unchanged.
   */
  netPostTaxPaise: Paise;
  /**
   * Gross revenue attributed to whoever actually delivered each session,
   * not whoever the package happened to be billed under. A package's full
   * price is billed on one session's visit; every other session in it is
   * logged separately at ₹0 so it isn't double-billed — which otherwise
   * credits 100% of a multi-session package to whichever therapist logged
   * session 1, even when a colleague delivered the rest. This spreads a
   * package's total bill evenly across its sessions, attributed to each
   * session's own therapist. Deliberately independent of billPaise/
   * bmSharePaise/postTaxPaise/sharedPaise above — those stay exactly what
   * was billed and split, for hospital reconciliation and the manual
   * same-visit Split override; this is a separate "who actually generated
   * this" lens, e.g. for comparing therapists or a revenue-share payout.
   */
  attributedRevenuePaise: Paise;
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
 * Per-visit attributed revenue for a set of visits (see TherapistMonthRow.
 * attributedRevenuePaise). A non-package visit (or a package's own solo
 * session) attributes to itself, unchanged. A visit inside a multi-session
 * package instead gets an equal share of the WHOLE package's billed total,
 * regardless of which single session actually carries that bill —
 * `listByPackageGroup` pulls every session in the package regardless of the
 * requested report's date range, so a package spanning two report periods
 * (started one month, finished the next) still attributes correctly to
 * whichever period each session actually happened in.
 */
async function attributedBillPaiseByVisit(
  visits: Visit[],
  repos: Pick<Repos, 'visits'>
): Promise<Map<UUID, Paise>> {
  const packageGroupIds = new Set(
    visits.filter((v) => v.packageGroupId && (v.packageTotal ?? 1) > 1).map((v) => v.packageGroupId!)
  );
  const billSumByGroup = new Map<UUID, Paise>();
  await Promise.all(
    [...packageGroupIds].map(async (groupId) => {
      const group = await repos.visits.listByPackageGroup(groupId);
      billSumByGroup.set(groupId, group.reduce((sum, g) => sum + g.actualBillPaise, 0));
    })
  );
  const attributed = new Map<UUID, Paise>();
  for (const v of visits) {
    const billSum = v.packageGroupId ? billSumByGroup.get(v.packageGroupId) : undefined;
    attributed.set(v.id, billSum != null && v.packageTotal ? roundToRupeeHalfUp(billSum / v.packageTotal) : v.actualBillPaise);
  }
  return attributed;
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
        attributedRevenuePaise: 0,
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

      const attributedByVisit = await attributedBillPaiseByVisit(visits, repos);
      for (const v of visits) {
        const amt = attributedByVisit.get(v.id) ?? v.actualBillPaise;
        rowFor(v.therapistId).attributedRevenuePaise += amt;
        total.attributedRevenuePaise += amt;
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
        'Revenue Generated',
        ...(hospitalSplit
          ? [`${labels.own} Share`, 'TDS Deducted', `Post Tax ${labels.own}`, `${labels.partner} Share`]
          : []),
        ...(therapistSplit ? ['Shared', 'Net'] : []),
        'Visits',
        'Patients',
      ];
      const line = (r: TherapistMonthRow) => [
        r.therapistName,
        paiseToRupees(r.billPaise),
        paiseToRupees(r.attributedRevenuePaise),
        ...(hospitalSplit
          ? [
              paiseToRupees(r.bmSharePaise),
              paiseToRupees(r.tdsPaise),
              paiseToRupees(r.postTaxPaise),
              paiseToRupees(r.hvPaise),
            ]
          : []),
        ...(therapistSplit ? [paiseToRupees(r.sharedPaise), paiseToRupees(r.netPostTaxPaise)] : []),
        r.visitCount,
        r.uniquePatients,
      ];
      return [header, ...report.rows.map(line), line(report.total)]
        .map((cells) => cells.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(','))
        .join('\n');
    },
  };
}
