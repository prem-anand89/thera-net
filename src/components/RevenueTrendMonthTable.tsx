import { useMemo, useState } from 'react';
import { formatINR } from '@/domain/money';
import { td, tdNum, th, thNum } from '@/components/ui';
import { monthOverMonthDelta, monthOverMonthPctSeries } from '@/components/chartTrendMath';

function PctCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[var(--muted)]">—</span>;
  const cls = value >= 0 ? 'text-[var(--moss)]' : 'text-[var(--rust)]';
  return (
    <span className={`font-num font-medium ${cls}`}>
      {value >= 0 ? '+' : ''}
      {value}%
    </span>
  );
}

function DeltaInrCell({ deltaPaise }: { deltaPaise: number | null }) {
  if (deltaPaise == null) return <span className="text-[var(--muted)]">—</span>;
  const cls = deltaPaise >= 0 ? 'text-[var(--moss)]' : 'text-[var(--rust)]';
  return (
    <span className={`font-num ${cls}`}>
      {deltaPaise >= 0 ? '+' : '−'}
      {formatINR(Math.abs(deltaPaise))}
    </span>
  );
}

/** Columns marked `secondary` only show from tablet width up — a phone keeps Month,
 *  revenue, its MoM % and visits so the table fits without sideways scrolling (the
 *  full set is still in "Copy month table"). */
const SECONDARY = 'hidden tab:table-cell';
const PHONE_PAD = 'max-tab:px-2';

function ColumnHead({
  title,
  detail,
  sticky,
  secondary,
}: {
  title: string;
  detail: string;
  sticky?: boolean;
  secondary?: boolean;
}) {
  const base = sticky ? `${th} sticky left-0 z-[1] bg-[var(--paper)] shadow-[2px_0_4px_rgba(0,0,0,0.04)]` : thNum;
  return (
    <th className={`${base} ${PHONE_PAD} ${secondary ? SECONDARY : ''}`}>
      <div>{title}</div>
      <div className="mt-0.5 hidden text-[9px] font-normal normal-case tracking-normal text-[var(--muted)] tab:block">
        {detail}
      </div>
    </th>
  );
}

/**
 * Month-by-month trend table — mirrors MonthlyReportTable patterns (sticky
 * first column, numeric right-align, overflow wrapper in parent) but scoped
 * to one time series instead of per-therapist rows.
 */
export function RevenueTrendMonthTable({
  monthLabels,
  revenuePaise,
  visitCounts,
  revenueColumnLabel,
  selectedIndex = null,
  onSelectIndex,
  inProgressIndices = [],
}: {
  monthLabels: string[];
  revenuePaise: number[];
  visitCounts: number[];
  revenueColumnLabel: string;
  selectedIndex?: number | null;
  onSelectIndex?: (index: number) => void;
  inProgressIndices?: number[];
}) {
  const [copyOk, setCopyOk] = useState(false);
  const revDelta = monthOverMonthDelta(revenuePaise);
  const revPct = monthOverMonthPctSeries(revenuePaise);
  const visitPct = monthOverMonthPctSeries(visitCounts);

  const totalRevenue = useMemo(() => revenuePaise.reduce((s, v) => s + v, 0), [revenuePaise]);
  const totalVisits = useMemo(() => visitCounts.reduce((s, v) => s + v, 0), [visitCounts]);
  const avgRpv = useMemo(() => {
    return totalRevenue > 0 && totalVisits > 0 ? Math.round(totalRevenue / 100 / totalVisits) : null;
  }, [totalRevenue, totalVisits]);

  async function copyTable() {
    const header = ['Month', revenueColumnLabel, 'Change ₹', 'Revenue MoM %', 'Visits', 'Visit MoM %', '₹/visit'].join(
      '\t'
    );
    const rows = monthLabels.map((lab, i) => {
      const rpv =
        revenuePaise[i] > 0 && visitCounts[i] > 0
          ? Math.round(revenuePaise[i] / 100 / visitCounts[i])
          : '';
      return [
        lab,
        revenuePaise[i] > 0 ? formatINR(revenuePaise[i]) : '',
        revDelta[i] != null ? formatINR(revDelta[i]) : '',
        revPct[i] ?? '',
        visitCounts[i] || '',
        visitPct[i] ?? '',
        rpv ? `₹${rpv}` : '',
      ].join('\t');
    });
    const totalRow = [
      'Period Total',
      totalRevenue > 0 ? formatINR(totalRevenue) : '',
      '',
      '',
      totalVisits > 0 ? totalVisits : '',
      '',
      avgRpv != null ? `₹${avgRpv}` : '',
    ].join('\t');
    try {
      await navigator.clipboard.writeText([header, ...rows, totalRow].join('\n'));
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      setCopyOk(false);
    }
  }

  return (
    <div>
      <div className="isolate overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="min-w-full divide-y divide-[var(--border)]">
            <thead className="bg-[var(--paper)]">
              <tr>
                <ColumnHead title="Month" detail="Calendar month in this window" sticky />
                <ColumnHead title={revenueColumnLabel} detail="Total for the month" />
                <ColumnHead title="Change ₹" detail="Net change vs prior month" secondary />
                <ColumnHead title="Rev. MoM" detail="% change vs prior month" />
                <ColumnHead title="Visits" detail="Completed sessions" />
                <ColumnHead title="Visit MoM" detail="% change vs prior month" secondary />
                <ColumnHead title="₹/visit" detail="Average revenue per visit" secondary />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {monthLabels.map((lab, i) => {
                const selected = selectedIndex === i;
                const inProgress = inProgressIndices.includes(i);
                const rpv =
                  revenuePaise[i] > 0 && visitCounts[i] > 0
                    ? Math.round(revenuePaise[i] / 100 / visitCounts[i])
                    : null;
                return (
                  <tr
                    key={lab}
                    className={`transition-colors ${
                      selected ? 'bg-[var(--teal-light)]/40 font-medium' : 'hover:bg-[var(--paper)]/60'
                    }`}
                    onMouseEnter={() => onSelectIndex?.(i)}
                    onClick={() => onSelectIndex?.(i)}
                  >
                    <td
                      className={`${td} ${PHONE_PAD} sticky left-0 z-[1] whitespace-nowrap shadow-[2px_0_4px_rgba(0,0,0,0.04)] ${
                        selected ? 'bg-[var(--teal-light)]/40' : 'bg-[var(--surface)]'
                      }`}
                    >
                      {lab}
                      {inProgress && (
                        <span className="block text-[10px] font-normal text-[var(--muted)] tab:ml-1 tab:inline">
                          <span className="hidden tab:inline">· </span>in progress
                        </span>
                      )}
                    </td>
                    <td className={`${tdNum} ${PHONE_PAD}`}>{revenuePaise[i] > 0 ? formatINR(revenuePaise[i]) : '—'}</td>
                    <td className={`${tdNum} ${PHONE_PAD} ${SECONDARY}`}>
                      <DeltaInrCell deltaPaise={revDelta[i]} />
                    </td>
                    <td className={`${tdNum} ${PHONE_PAD}`}>
                      <PctCell value={revPct[i]} />
                    </td>
                    <td className={`${tdNum} ${PHONE_PAD}`}>{visitCounts[i] > 0 ? visitCounts[i] : '—'}</td>
                    <td className={`${tdNum} ${PHONE_PAD} ${SECONDARY}`}>
                      <PctCell value={visitPct[i]} />
                    </td>
                    <td className={`${tdNum} ${PHONE_PAD} ${SECONDARY}`}>{rpv != null ? formatINR(rpv * 100) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            {/* Period Total & Weighted Average Row */}
            <tfoot className="border-t-2 border-[var(--border)] bg-[var(--paper)] font-semibold">
              <tr>
                <td
                  className={`${td} ${PHONE_PAD} sticky left-0 z-[1] bg-[var(--paper)] shadow-[2px_0_4px_rgba(0,0,0,0.04)] font-semibold text-[var(--ink)]`}
                >
                  Total
                </td>
                <td className={`${tdNum} ${PHONE_PAD} font-bold text-[var(--ink)]`}>
                  {totalRevenue > 0 ? formatINR(totalRevenue) : '—'}
                </td>
                <td className={`${tdNum} ${PHONE_PAD} ${SECONDARY}`}>—</td>
                <td className={`${tdNum} ${PHONE_PAD}`}>—</td>
                <td className={`${tdNum} ${PHONE_PAD} font-bold text-[var(--ink)]`}>
                  {totalVisits > 0 ? totalVisits : '—'}
                </td>
                <td className={`${tdNum} ${PHONE_PAD} ${SECONDARY}`}>—</td>
                <td className={`${tdNum} ${PHONE_PAD} ${SECONDARY} font-bold text-[var(--ink)]`}>
                  {avgRpv != null ? formatINR(avgRpv * 100) : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] shadow-xs hover:bg-[var(--paper)] transition-colors self-start sm:self-auto cursor-pointer"
          onClick={() => copyTable()}
        >
          <span>{copyOk ? '✓ Copied table' : '📋 Copy month table'}</span>
        </button>
        <p className="text-[11px] text-[var(--muted)]">
          <span className="tab:hidden">Tap a month to highlight it on the charts. More columns on a wider screen.</span>
          <span className="hidden tab:inline">Select a row to highlight that month on the charts above.</span>
        </p>
      </div>
    </div>
  );
}
