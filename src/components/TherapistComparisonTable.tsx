import { useMemo, useState } from 'react';
import { formatINR } from '@/domain/money';
import { th, thNum, td, tdNum } from '@/components/ui';
import {
  columnLeaders,
  metricValue,
  MIN_VISITS_FOR_RANKING,
  type RankMetric,
} from '@/domain/therapistRanking';

export function TableColumnHead({
  title,
  detail,
  onSort,
  sorted,
}: {
  title: string;
  detail: string;
  onSort?: () => void;
  sorted?: boolean;
}) {
  return (
    <th className={thNum} aria-sort={sorted ? 'descending' : undefined}>
      <div>
        {onSort ? (
          <button
            type="button"
            onClick={onSort}
            className="min-h-6 font-semibold uppercase tracking-wide hover:text-[var(--ink)]"
            aria-label={`Sort by ${title}`}
          >
            {title}
            {sorted ? ' ↓' : ''}
          </button>
        ) : (
          title
        )}
      </div>
      <div className="mt-0.5 text-[9px] font-normal normal-case tracking-normal text-[var(--muted)]">
        {detail}
      </div>
    </th>
  );
}

export type TherapistComparisonRow = {
  therapistName: string;
  billPaise: number;
  postTaxPaise: number;
  netPostTaxPaise: number;
  visitCount: number;
  retentionPct: number | null;
  newPackages: number;
  /** Work done / time available, 0-1. Undefined = not computed; null = nothing was available. */
  utilisation?: number | null;
  /** Utilisation used the clinic's booking hours because no personal hours are set. */
  utilisationClinicHours?: boolean;
};

export function TherapistComparisonTable({
  rows,
  total,
  showPostTax,
  ownLabel,
}: {
  rows: TherapistComparisonRow[];
  total?: TherapistComparisonRow;
  showPostTax: boolean;
  ownLabel: string;
}) {
  const showUtilisation = rows.some((r) => r.utilisation !== undefined);
  const [sortBy, setSortBy] = useState<RankMetric | null>(null);
  const toggleSort = (metric: RankMetric) => setSortBy((c) => (c === metric ? null : metric));
  const leaders = useMemo(
    () => columnLeaders(rows, ['net', 'visits', 'retention', ...(showUtilisation ? (['utilisation'] as const) : [])]),
    [rows, showUtilisation]
  );
  const shownRows = useMemo(() => {
    if (!sortBy) return rows;
    return [...rows].sort(
      (a, b) => (metricValue(b, sortBy) ?? -Infinity) - (metricValue(a, sortBy) ?? -Infinity)
    );
  }, [rows, sortBy]);
  const anyLeader = Object.values(leaders).some((set) => set.size > 0);
  const lead = (metric: RankMetric, name: string) =>
    leaders[metric].has(name) ? (
      <span className="ml-1 rounded bg-[var(--teal-light)] px-1 text-[9px] font-semibold uppercase text-[var(--teal-strong)]">
        Top
      </span>
    ) : null;
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--paper)]">
            <tr>
              <th
                className={`${th} sticky left-0 z-[1] bg-[var(--paper)] shadow-[2px_0_4px_rgba(0,0,0,0.04)]`}
              >
                <div>Therapist</div>
                <div className="mt-0.5 text-[9px] font-normal normal-case tracking-normal text-[var(--muted)]">
                  Team member
                </div>
              </th>
              <TableColumnHead title="Bill amount" detail="Total billed in period" />
              {showPostTax && (
                <TableColumnHead title={`Post tax ${ownLabel}`} detail="Clinic share after TDS" />
              )}
              <TableColumnHead title="Net" detail="After splits & package attribution" onSort={() => toggleSort('net')} sorted={sortBy === 'net'} />
              <TableColumnHead title="Visits" detail="Sessions in period" onSort={() => toggleSort('visits')} sorted={sortBy === 'visits'} />
              <TableColumnHead title="Retention" detail="Repeat visits within 30 days, % of visits" onSort={() => toggleSort('retention')} sorted={sortBy === 'retention'} />
              <TableColumnHead title="Packages" detail="New packages started in period" />
              {showUtilisation && (
                <TableColumnHead title="Utilisation" detail="Visits × slot time ÷ available hours" onSort={() => toggleSort('utilisation')} sorted={sortBy === 'utilisation'} />
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
            {shownRows.map((row) => (
              <tr key={row.therapistName} className="hover:bg-[var(--paper)]/50 transition-colors">
                <td
                  className={`${td} sticky left-0 z-[1] bg-[var(--surface)] shadow-[2px_0_4px_rgba(0,0,0,0.04)] font-medium text-[var(--ink)]`}
                >
                  {row.therapistName}
                </td>
                <td className={tdNum}>{formatINR(row.billPaise)}</td>
                {showPostTax && <td className={tdNum}>{formatINR(row.postTaxPaise)}</td>}
                <td className={tdNum}>{formatINR(row.netPostTaxPaise)}{lead('net', row.therapistName)}</td>
                <td className={tdNum}>{row.visitCount}{lead('visits', row.therapistName)}</td>
                <td className={tdNum}>
                  {row.retentionPct != null ? `${row.retentionPct}%` : '—'}
                  {lead('retention', row.therapistName)}
                </td>
                <td className={tdNum}>{row.newPackages}</td>
                {showUtilisation && (
                  <td
                    className={tdNum}
                    title={row.utilisationClinicHours ? 'Based on clinic hours — no personal hours set' : undefined}
                  >
                    {row.utilisation != null ? `${Math.round(row.utilisation * 100)}%` : '—'}
                    {row.utilisation != null && row.utilisationClinicHours ? '*' : ''}
                    {lead('utilisation', row.therapistName)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {total && (
            <tfoot className="border-t-2 border-[var(--border)] bg-[var(--paper)] font-semibold text-sm">
              <tr>
                <td
                  className={`${td} sticky left-0 z-[1] bg-[var(--paper)] shadow-[2px_0_4px_rgba(0,0,0,0.04)] font-semibold text-[var(--ink)]`}
                >
                  Total
                </td>
                <td className={`${tdNum} font-bold text-[var(--ink)]`}>{formatINR(total.billPaise)}</td>
                {showPostTax && <td className={`${tdNum} font-bold text-[var(--ink)]`}>{formatINR(total.postTaxPaise)}</td>}
                <td className={`${tdNum} font-bold text-[var(--ink)]`}>{formatINR(total.netPostTaxPaise)}</td>
                <td className={`${tdNum} font-bold text-[var(--ink)]`}>{total.visitCount}</td>
                <td className={tdNum}>—</td>
                <td className={`${tdNum} font-bold text-[var(--ink)]`}>{total.newPackages}</td>
                {showUtilisation && <td className={tdNum}>—</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {anyLeader && (
        <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
          Top marks the best in each column among therapists with at least {MIN_VISITS_FOR_RANKING} visits in the period.
        </p>
      )}
      {showUtilisation && rows.some((r) => r.utilisationClinicHours) && (
        <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
          * No personal working hours set, so clinic booking hours were used as available time.
        </p>
      )}
    </div>
  );
}
