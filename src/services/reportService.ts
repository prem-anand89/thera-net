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
   * full price is billed on one session's visit, with every other session
   * logged separately at ₹0 so it isn't double-billed, which otherwise
   * credits 100% of a multi-session package to whichever therapist logged
   * session 1 even when a colleague delivered the rest. This spreads a
   * package's Post-Tax BM evenly (whole rupees, exact remainder
   * distribution — never rounding-drifts from the package's own total)
   * across its sessions, credited to each session's own therapist.
   * `total.netPostTaxPaise` always equals `total.postTaxPaise` unchanged —
   * attribution only redistributes which ROW a rupee counts under, never
   * what the clinic-wide total claims. A package spanning two report
   * periods (started one month, finished the next) therefore moves some
   * credit across rows within a single period without the row-level sum
   * necessarily equaling that period's total — the point of attribution is
   * exactly that a session's true credit doesn't always land in the
   * billing month.
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
 * Per-visit attributed Post-Tax BM for a set of visits (see
 * TherapistMonthRow.netPostTaxPaise). A non-package visit (or a package's
 * own solo session) attributes to itself, unchanged. A visit inside a
 * multi-session package instead gets an equal share of the WHOLE package's
 * Post-Tax BM, regardless of which single session actually carries the
 * bill (and therefore the tax/split maths) — divided by the package's
 * declared `packageTotal` (not how many sessions have been logged so far),
 * so an in-progress package's per-session share stays stable rather than
 * jumping around as later sessions get logged. Shares are whole rupees
 * (every visit's own `postTaxPaise` already is) distributed with a
 * deterministic largest-remainder rule — the earliest-logged sessions get
 * any leftover rupee — so they sum EXACTLY to the package's total, never
 * rounding-drifting the way independently rounding each share would.
 * `listByPackageGroup` pulls every session in the package regardless of
 * the requested report's date range, so a package spanning two report
 * periods (started one month, finished the next) still attributes
 * correctly to whichever period each session actually happened in.
 */
async function attributedPostTaxPaiseByVisit(
  visits: Visit[],
  repos: Pick<Repos, 'visits'>
): Promise<Map<UUID, Paise>> {
  const packageGroupIds = new Set(
    visits.filter((v) => v.packageGroupId && (v.packageTotal ?? 1) > 1).map((v) => v.packageGroupId!)
  );
  const attributed = new Map<UUID, Paise>();
  await Promise.all(
    [...packageGroupIds].map(async (groupId) => {
      const group = (await repos.visits.listByPackageGroup(groupId)).sort(
        (a, b) => a.visitDate.localeCompare(b.visitDate) || a.id.localeCompare(b.id)
      );
      const packageTotal = group[0]?.packageTotal || group.length;
      const totalRupees = group.reduce((sum, g) => sum + g.postTaxPaise, 0) / 100;
      const baseRupees = Math.floor(totalRupees / packageTotal);
      const remainder = totalRupees - baseRupees * packageTotal;
      group.forEach((g, i) => {
        attributed.set(g.id, ((i < remainder ? baseRupees + 1 : baseRupees) * 100) as Paise);
      });
    })
  );
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

      // Automatic package-session attribution — applied only to each
      // visit's own row, never to `total`, so the clinic-wide total always
      // stays exactly what was actually billed and split this period;
      // attribution only redistributes which row a rupee counts under.
      const attributedPostTax = await attributedPostTaxPaiseByVisit(visits, repos);
      for (const v of visits) {
        const attributed = attributedPostTax.get(v.id) ?? v.postTaxPaise;
        rowFor(v.therapistId).netPostTaxPaise += attributed - v.postTaxPaise;
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
