import { useState } from 'react';
import { formatINR } from '@/domain/money';
import { btnSecondary, td, tdNum, th, thNum } from '@/components/ui';
import { monthOverMonthDelta, monthOverMonthPctSeries } from '@/components/chartTrendMath';

function PctCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[var(--muted)]">—</span>;
  const cls = value >= 0 ? 'text-[var(--moss)]' : 'text-[var(--rust)]';
  return <span className={`font-num font-medium ${cls}`}>{value >= 0 ? '+' : ''}{value}%</span>;
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

  async function copyTable() {
    const header = ['Month', revenueColumnLabel, 'Δ ₹', 'Rev MoM %', 'Visits', 'Visit MoM %', '₹/visit'].join(
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
    try {
      await navigator.clipboard.writeText([header, ...rows].join('\n'));
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      setCopyOk(false);
    }
  }

  return (
    <div>
      <div className="-mx-1 overflow-x-auto overscroll-x-contain">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--paper)]">
            <tr>
              <th className={`${th} sticky left-0 z-[1] bg-[var(--paper)] shadow-[2px_0_4px_rgba(0,0,0,0.04)]`}>
                Month
              </th>
              <th className={thNum}>{revenueColumnLabel}</th>
              <th className={thNum}>Δ ₹</th>
              <th className={thNum}>Rev MoM</th>
              <th className={thNum}>Visits</th>
              <th className={thNum}>Visit MoM</th>
              <th className={thNum}>₹/visit</th>
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
                  className={selected ? 'bg-[var(--teal-light)]/40' : undefined}
                  onMouseEnter={() => onSelectIndex?.(i)}
                >
                  <td
                    className={`${td} sticky left-0 z-[1] shadow-[2px_0_4px_rgba(0,0,0,0.04)] ${
                      selected ? 'bg-[var(--teal-light)]/40' : 'bg-[var(--surface)]'
                    }`}
                  >
                    {lab}
                    {inProgress && (
                      <span className="ml-1 text-[10px] font-normal text-[var(--muted)]">· in progress</span>
                    )}
                  </td>
                  <td className={tdNum}>{revenuePaise[i] > 0 ? formatINR(revenuePaise[i]) : '—'}</td>
                  <td className={tdNum}>
                    <DeltaInrCell deltaPaise={revDelta[i]} />
                  </td>
                  <td className={tdNum}>
                    <PctCell value={revPct[i]} />
                  </td>
                  <td className={tdNum}>{visitCounts[i] > 0 ? visitCounts[i] : '—'}</td>
                  <td className={tdNum}>
                    <PctCell value={visitPct[i]} />
                  </td>
                  <td className={tdNum}>{rpv != null ? formatINR(rpv * 100) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className={`${btnSecondary} mt-3 w-full sm:w-auto`} onClick={() => copyTable()}>
        {copyOk ? 'Copied' : 'Copy month table'}
      </button>
      <p className="mt-2 text-[11px] text-[var(--muted)]">
        Swipe sideways on small screens. Row highlights when you hover a chart. Visit growth % is in this table only
        (waterfall above is revenue ₹ only).
      </p>
    </div>
  );
}
