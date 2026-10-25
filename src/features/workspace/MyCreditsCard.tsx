import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { attributionAuditService, repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { formatDateDMY, monthName } from '@/domain/fiscalYear';
import type { UUID } from '@/domain/types';
import { inputCls } from '@/components/ui';
import { myBasisText, myRows } from '@/features/reports/attributionAuditView';

/** The last six calendar months, newest first, as `{year, month}`. */
function recentMonths(now = new Date()) {
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
}

/**
 * A therapist's own credits and debits for a month: money that reached them from a colleague's visit
 * (a share, or a package session they ran) and money that went to a colleague. Their own rows only, in
 * rupees, with no bill or package price, so they can check their Net without asking the admin.
 */
export function MyCreditsCard({ therapistId }: { therapistId: UUID }) {
  const clinic = useClinic();
  const months = useMemo(() => recentMonths(), []);
  const [value, setValue] = useState(`${months[0].year}-${months[0].month}`);
  const [year, month] = value.split('-').map(Number);

  const entries = useLiveQuery(
    () => attributionAuditService.monthly(clinic.id, { year, month }),
    [clinic.id, year, month]
  );
  const patients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const patientName = new Map((patients ?? []).map((p) => [p.id, p.name]));
  const nameOf = (id: UUID) => (therapists ?? []).find((t) => t.id === id)?.name ?? 'Colleague';

  const rows = useMemo(() => myRows(entries ?? [], therapistId), [entries, therapistId]);
  const credits = rows.filter((r) => r.signedPaise > 0).reduce((s, r) => s + r.signedPaise, 0);
  const debits = rows.filter((r) => r.signedPaise < 0).reduce((s, r) => s - r.signedPaise, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">
          Money that came to you from colleagues&apos; visits, and money that went to them.
        </p>
        <select
          aria-label="Month"
          className={`${inputCls} !w-auto`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        >
          {months.map((m) => (
            <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
              {monthName(m.month)} {m.year}
            </option>
          ))}
        </select>
      </div>

      {entries && rows.length === 0 && (
        <p className="rounded-lg bg-[var(--paper)] px-3 py-6 text-center text-sm text-[var(--muted)]">
          Nothing moved to or from you this month.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-[var(--paper)] p-2">
              <div className="text-[var(--muted)]">Credits</div>
              <div className="font-num text-sm font-semibold text-[var(--ink)]">{formatINR(credits)}</div>
            </div>
            <div className="rounded-lg bg-[var(--paper)] p-2">
              <div className="text-[var(--muted)]">Debits</div>
              <div className="font-num text-sm font-semibold text-[var(--ink)]">{formatINR(debits)}</div>
            </div>
            <div className="rounded-lg bg-[var(--paper)] p-2">
              <div className="text-[var(--muted)]">Net change</div>
              <div className="font-num text-sm font-semibold text-[var(--ink)]">
                {credits - debits < 0 ? '−' : ''}
                {formatINR(Math.abs(credits - debits))}
              </div>
            </div>
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((r, i) => (
              <li key={`${r.entry.visitId}-${i}`} className="flex items-start justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-[var(--ink)]">{patientName.get(r.entry.patientId) ?? '—'}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {formatDateDMY(r.entry.visitDate)} · {r.signedPaise > 0 ? 'from' : 'to'}{' '}
                    {nameOf(r.withTherapistId)} · {myBasisText(r.entry, nameOf)}
                  </span>
                </span>
                <span
                  className={`font-num shrink-0 font-semibold ${r.signedPaise > 0 ? 'text-[var(--moss-strong)]' : 'text-[var(--rust)]'}`}
                >
                  {r.signedPaise > 0 ? '+' : '−'}
                  {formatINR(Math.abs(r.signedPaise))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
