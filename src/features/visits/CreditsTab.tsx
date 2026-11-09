import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { attributionAuditService, repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useDepartment } from '@/app/DepartmentContext';
import { inDepartment } from '@/domain/departments';
import { usePermissions } from '@/app/usePermissions';
import { formatAmount } from '@/domain/money';
import { monthName } from '@/domain/fiscalYear';
import type { UUID } from '@/domain/types';
import { LoadingRows, Pill, inputCls, pillSmNeutral } from '@/components/ui';
import { ShowMoreFooter, useShowMore } from '@/components/ShowMore';
import { myRows, toAuditCsv } from '@/features/reports/attributionAuditView';
import { MonthStepper } from './MonthStepper';
import { clinicTotals, colleagueTotals, creditLines, creditsSummary } from './creditsView';

const MONTHS_BACK = 6;

/** The last six calendar months, newest first. */
function recentMonths(now = new Date()) {
  return Array.from({ length: MONTHS_BACK }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
}

const monthLabel = (m: { year: number; month: number }) => `${monthName(m.month).slice(0, 3)} ${m.year}`;
const signed = (paise: number) => `${paise < 0 ? '−' : paise > 0 ? '+' : ''}${formatAmount(Math.abs(paise))}`;
const amountTone = (paise: number) => (paise > 0 ? 'text-[var(--moss-strong)]' : paise < 0 ? 'text-[var(--rust)]' : 'text-[var(--ink)]');
const sectionTitle = 'px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]';

/**
 * Ledger → Credits. A therapist's own credits and debits for a month: money that reached them from a colleague's visit
 * (a share, or a package session they ran) and money that went to a colleague. An admin also gets a View menu: the
 * whole clinic (each therapist's gave, received and net) or one colleague's statement exactly as they see it. Never a
 * bill amount or a package price; the admin's full audit (Reports) has those.
 */
export function CreditsTab({ myTherapistId, isAdmin }: { myTherapistId?: UUID; isAdmin: boolean }) {
  const clinic = useClinic();
  const { canViewPayouts } = usePermissions();
  const months = useMemo(() => recentMonths(), []);
  const [monthIndex, setMonthIndex] = useState(0);
  const selected = months[monthIndex];
  const previous = months[monthIndex + 1];

  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const patients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  const nameOf = (id: UUID) => (therapists ?? []).find((t) => t.id === id)?.name ?? 'Colleague';
  const patientName = (id: UUID) => (patients ?? []).find((p) => p.id === id)?.name ?? '—';

  // Who this page shows: a therapist only themselves; an admin picks (themselves if they treat, else the clinic first).
  const [choice, setChoice] = useState<string | null>(null);
  const view = !isAdmin ? 'me' : (choice ?? (myTherapistId ? 'me' : 'clinic'));
  const subjectId = view === 'me' ? myTherapistId : view === 'clinic' ? undefined : (view as UUID);
  const isSelf = subjectId !== undefined && subjectId === myTherapistId;

  const { department } = useDepartment();
  const entries = useLiveQuery(
    () => attributionAuditService.monthly(clinic.id, selected),
    [clinic.id, selected.year, selected.month]
  );
  const deptEntries = useMemo(
    () => (entries ? entries.filter((e) => inDepartment(department, e)) : undefined),
    [entries, department]
  );
  const rows = useMemo(() => (deptEntries && subjectId ? myRows(deptEntries, subjectId) : []), [deptEntries, subjectId]);
  const clinicView = useMemo(() => (deptEntries && !subjectId ? clinicTotals(deptEntries) : undefined), [deptEntries, subjectId]);
  const isEmpty = deptEntries !== undefined && (subjectId ? rows.length === 0 : deptEntries.length === 0);

  // An empty month says what the month before had, so it is never a dead end.
  const previousEntries = useLiveQuery(
    () => (isEmpty && previous ? attributionAuditService.monthly(clinic.id, previous) : undefined),
    [isEmpty, clinic.id, previous?.year, previous?.month]
  );
  const deptPreviousEntries = useMemo(
    () => (previousEntries ? previousEntries.filter((e) => inDepartment(department, e)) : undefined),
    [previousEntries, department]
  );
  const previousCount = deptPreviousEntries ? (subjectId ? myRows(deptPreviousEntries, subjectId).length : deptPreviousEntries.length) : 0;

  const lines = useMemo(
    () => (subjectId ? creditLines(rows, { subjectId, isSelf, nameOf }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, subjectId, isSelf, therapists]
  );
  const summary = useMemo(() => creditsSummary(rows), [rows]);
  const colleagues = useMemo(() => colleagueTotals(rows), [rows]);
  const list = useShowMore(lines, `${selected.year}-${selected.month}|${view}`, 10);

  const subjectName = subjectId ? nameOf(subjectId) : '';
  const whose = isSelf ? 'you' : subjectName;

  const viewOptions = useMemo(() => {
    if (!isAdmin) return [];
    const others = (therapists ?? []).filter((t) => t.active && t.id !== myTherapistId);
    return [
      ...(myTherapistId ? [{ value: 'me', label: 'Me' }] : []),
      { value: 'clinic', label: 'Whole clinic' },
      ...others.map((t) => ({ value: t.id, label: t.name })),
    ];
  }, [isAdmin, therapists, myTherapistId]);

  function downloadCsv() {
    if (!deptEntries) return;
    const blob = new Blob([toAuditCsv(deptEntries, nameOf, patientName)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clinic.invoicePrefix}-credits-${selected.year}-${String(selected.month).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h2 className="font-display text-base font-semibold text-[var(--ink)]">Credits and debits</h2>
      <div className="flex flex-wrap items-center gap-2">
        {viewOptions.length > 1 && (
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            View
            <select aria-label="View" className={`${inputCls} !w-auto !py-1`} value={view} onChange={(e) => setChoice(e.target.value)}>
              {viewOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <MonthStepper
          label={monthLabel(selected)}
          canPrev={monthIndex < MONTHS_BACK - 1}
          canNext={monthIndex > 0}
          onPrev={() => setMonthIndex((i) => Math.min(MONTHS_BACK - 1, i + 1))}
          onNext={() => setMonthIndex((i) => Math.max(0, i - 1))}
        />
      </div>
    </div>
  );

  const emptyNote = isEmpty ? (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center">
      <p className="text-sm text-[var(--muted)]">
        {subjectId ? `Nothing moved to or from ${whose}` : 'Nothing moved between therapists'} in {monthName(selected.month)}.
      </p>
      {previousCount > 0 && previous && (
        <button type="button" className={`${pillSmNeutral} mt-3`} onClick={() => setMonthIndex((i) => i + 1)}>
          {monthName(previous.month)} had {previousCount} {previousCount === 1 ? 'entry' : 'entries'} ›
        </button>
      )}
    </div>
  ) : null;

  // The whole-clinic table (admin).
  if (!subjectId) {
    return (
      <div className="space-y-4">
        {header}
        {entries === undefined && <LoadingRows label="Loading credits" />}
        {emptyNote}
        {clinicView && clinicView.rows.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-3 py-2 font-semibold">Therapist</th>
                    <th className="px-3 py-2 text-right font-semibold">Gave</th>
                    <th className="px-3 py-2 text-right font-semibold">Received</th>
                    <th className="px-3 py-2 text-right font-semibold">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {clinicView.rows.map((r) => (
                    <tr key={r.therapistId}>
                      <td className="px-3 py-2">
                        <button type="button" className="font-medium text-[var(--teal)] hover:underline" onClick={() => setChoice(r.therapistId === myTherapistId ? 'me' : r.therapistId)}>
                          {nameOf(r.therapistId)}
                          {r.therapistId === myTherapistId ? ' (you)' : ''}
                        </button>
                      </td>
                      <td className="font-num px-3 py-2 text-right tabular-nums">{formatAmount(r.gave)}</td>
                      <td className="font-num px-3 py-2 text-right tabular-nums">{formatAmount(r.received)}</td>
                      <td className={`font-num px-3 py-2 text-right font-semibold tabular-nums ${amountTone(r.net)}`}>{signed(r.net)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--border)] bg-[var(--paper)] font-semibold">
                    <td className="px-3 py-2">Total moved</td>
                    <td className="font-num px-3 py-2 text-right tabular-nums" colSpan={3}>
                      {formatAmount(clinicView.movedPaise)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-[var(--muted)]">Tap a therapist to see their statement as they see it, without bill amounts.</span>
              <span className="flex flex-wrap items-center gap-3">
                <button type="button" className="font-medium text-[var(--teal)] hover:underline" onClick={downloadCsv}>
                  Download CSV
                </button>
                {canViewPayouts && (
                  <Link to="/insights" search={{ tab: 'audit', year: selected.year, month: selected.month }} className="font-medium text-[var(--teal)] hover:underline">
                    Full audit with bill amounts →
                  </Link>
                )}
              </span>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      {entries === undefined && <LoadingRows label="Loading credits" />}
      {emptyNote}
      {rows.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
          <div className="space-y-3 lg:sticky lg:top-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
              <p className="text-xs text-[var(--muted)]">Net this month{isSelf ? '' : ` · ${subjectName}`}</p>
              <p className={`mt-1 font-display text-3xl font-semibold tabular-nums ${summary.net > 0 ? 'text-[var(--moss-strong)]' : 'text-[var(--ink)]'}`}>{signed(summary.net)}</p>
              <p className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-[var(--muted)]">
                <span>
                  Credits <strong className="font-num font-semibold tabular-nums">{formatAmount(summary.credits)}</strong>
                </span>
                <span>
                  Debits <strong className="font-num font-semibold tabular-nums">{formatAmount(summary.debits)}</strong>
                </span>
              </p>
            </div>
            <p className={sectionTitle}>Net with each colleague</p>
            <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              {colleagues.map((c) => (
                <li key={c.colleagueId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-display font-medium text-[var(--ink)]">{nameOf(c.colleagueId)}</span>
                    <span className="block text-xs text-[var(--muted)]">
                      {c.count} {c.count === 1 ? 'entry' : 'entries'}
                    </span>
                  </span>
                  <span className={`font-num shrink-0 font-semibold tabular-nums ${amountTone(c.netPaise)}`}>{signed(c.netPaise)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <p className={sectionTitle}>Entries · {lines.length}</p>
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <ul className="divide-y divide-[var(--border)]">
                {list.visible.map((l) => (
                  <li key={l.key} className="flex items-start justify-between gap-3 px-4 py-3">
                    <span className="min-w-0 space-y-1">
                      <Link to="/patients/$patientId" params={{ patientId: l.patientId }} search={{ from: '/ledger' }} className="block break-words font-display text-sm font-medium text-[var(--ink)] hover:underline">
                        {patientName(l.patientId)}
                      </Link>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Pill tone={l.direction === 'from' ? 'green' : 'rust'}>
                          {l.direction === 'from' ? 'From' : 'To'} {nameOf(l.colleagueId)}
                        </Pill>
                        <Pill tone="slate">{l.reason}</Pill>
                      </span>
                      <span className="block text-xs text-[var(--muted)]">{l.detail}</span>
                    </span>
                    <span className={`font-num shrink-0 text-sm font-semibold tabular-nums ${amountTone(l.signedPaise)}`}>{signed(l.signedPaise)}</span>
                  </li>
                ))}
              </ul>
              <ShowMoreFooter list={list} noun="entries" />
            </div>
            <p className="px-0.5 text-[11px] text-[var(--muted)]">Only {isSelf ? 'your' : `${subjectName}'s`} entries. Bill amounts and package prices are not shown.</p>
          </div>
        </div>
      )}
    </div>
  );
}
