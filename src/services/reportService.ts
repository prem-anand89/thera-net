import type { UUID } from '@/domain/types';
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
      const labels = opts.labels ?? { own: 'BM', partner: 'HV' };
      const hospitalSplit = opts.hospitalSplit ?? true;
      const therapistSplit = opts.therapistSplit ?? true;

      const header = [
        'Therapist',
        'Bill Amount',
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
