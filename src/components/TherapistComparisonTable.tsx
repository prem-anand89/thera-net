import { formatINR } from '@/domain/money';
import { th, thNum, td, tdNum } from '@/components/ui';

export function TableColumnHead({ title, detail }: { title: string; detail: string }) {
  return (
    <th className={thNum}>
      <div>{title}</div>
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
  return (
    <div className="overflow-x-auto overscroll-x-contain rounded-lg border border-[var(--border)]">
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
            <TableColumnHead title="Net" detail="After splits & package attribution" />
            <TableColumnHead title="Visits" detail="Sessions in period" />
            <TableColumnHead title="Retention" detail="Repeat visits within 30 days, % of visits" />
            <TableColumnHead title="Packages" detail="New packages started in period" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row) => (
            <tr key={row.therapistName}>
              <td
                className={`${td} sticky left-0 z-[1] bg-[var(--surface)] shadow-[2px_0_4px_rgba(0,0,0,0.04)]`}
              >
                {row.therapistName}
              </td>
              <td className={tdNum}>{formatINR(row.billPaise)}</td>
              {showPostTax && <td className={tdNum}>{formatINR(row.postTaxPaise)}</td>}
              <td className={tdNum}>{formatINR(row.netPostTaxPaise)}</td>
              <td className={tdNum}>{row.visitCount}</td>
              <td className={tdNum}>
                {row.retentionPct != null ? `${row.retentionPct}%` : '—'}
              </td>
              <td className={tdNum}>{row.newPackages}</td>
            </tr>
          ))}
          {total && (
            <tr className="bg-[var(--paper)] font-semibold">
              <td
                className={`${td} sticky left-0 z-[1] bg-[var(--paper)] shadow-[2px_0_4px_rgba(0,0,0,0.04)]`}
              >
                Total
              </td>
              <td className={tdNum}>{formatINR(total.billPaise)}</td>
              {showPostTax && <td className={tdNum}>{formatINR(total.postTaxPaise)}</td>}
              <td className={tdNum}>{formatINR(total.netPostTaxPaise)}</td>
              <td className={tdNum}>{total.visitCount}</td>
              <td className={tdNum}>—</td>
              <td className={tdNum}>{total.newPackages}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
