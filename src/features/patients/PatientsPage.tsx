import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, patientService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { usePermissions } from '@/app/usePermissions';
import { formatINR } from '@/domain/money';
import { computeVisitPaymentState, isCollected, paymentActions } from '@/domain/paymentState';
import { EditPatientModal } from './EditPatientModal';
import {
  fiscalYearOf,
  monthsOfFiscalYear,
  monthDateRange,
  fiscalYearDateRange,
  fiscalYearToDateRange,
  monthName,
  formatDateDMY,
  formatDateDM,
} from '@/domain/fiscalYear';
import { type Patient, type Visit } from '@/domain/types';
import {
  inputCls,
  th,
  td,
  ErrorNote,
  Pill,
  SectionCard,
  KebabMenu,
  menuItem,
  TherapistPill,
} from '@/components/ui';
import { patientIdentityLine, CardDetailRow } from '@/components/VisitCard';
import { applySort, byNumber, byString, SortHeader, useSort } from '@/components/sortable';
import { toFriendlyMessage } from '@/lib/errors';

type PatientSortKey = 'name' | 'mrno' | 'age' | 'condition' | 'lastVisit';
const PATIENT_COMPARATORS = {
  name: byString<Patient>((p) => p.name),
  mrno: byString<Patient>((p) => p.mrno),
  age: byNumber<Patient>((p) => p.age ?? -1),
  condition: byString<Patient>((p) => p.primaryCondition ?? ''),
};

export function PatientsPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Patients</h1>
      <AllPatientsSection />
    </div>
  );
}

function AllPatientsSection() {
  const clinic = useClinic();
  const { myTherapistId } = useWorkspaceScope();
  const { canBill } = usePermissions();
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<'all' | 'needs_invoice' | 'mine'>('all');
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Patient | null>(null);
  const sort = useSort<PatientSortKey>('lastVisit', 'desc');

  const currentFy = fiscalYearOf(new Date(), clinic.fyStartMonth);
  const [fyStartYear, setFyStartYear] = useState(currentFy.startYear);
  // '' = Full FY, 'ytd' = year to date, 'custom' = customFrom/customTo,
  // otherwise a specific "YYYY-M" month value.
  const [month, setMonth] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const months = useMemo(
    () => monthsOfFiscalYear(fyStartYear, clinic.fyStartMonth),
    [fyStartYear, clinic.fyStartMonth]
  );
  const selectedPeriod = useMemo(() => {
    if (!month || month === 'ytd' || month === 'custom') return null;
    const [y, m] = month.split('-').map(Number);
    return { year: y, month: m };
  }, [month]);

  // No month picked doesn't mean "no filter" — it means "the whole selected
  // fiscal year," so the FY dropdown actually does something. A genuinely
  // unfiltered "every patient ever" view isn't offered by this control.
  const selectedRange = useMemo(() => {
    if (selectedPeriod) return monthDateRange(selectedPeriod);
    if (month === 'ytd') return fiscalYearToDateRange(fyStartYear, clinic.fyStartMonth);
    if (month === 'custom') return { from: customFrom, to: customTo };
    return fiscalYearDateRange(fyStartYear, clinic.fyStartMonth);
  }, [selectedPeriod, month, fyStartYear, clinic.fyStartMonth, customFrom, customTo]);
  const periodVisits = useLiveQuery(
    () =>
      repos.visits.list({ clinicId: clinic.id, from: selectedRange.from, to: selectedRange.to }),
    [clinic.id, selectedRange.from, selectedRange.to]
  );
  const periodPatientIds = useMemo(
    () => (periodVisits ? new Set(periodVisits.map((v) => v.patientId)) : null),
    [periodVisits]
  );

  const all = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  const allVisits = useLiveQuery(() => repos.visits.list({ clinicId: clinic.id }), [clinic.id]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const invoicePayments = useLiveQuery(() => repos.invoicePayments.list(clinic.id), [clinic.id]);
  const directPayments = useLiveQuery(() => repos.payments.list(clinic.id), [clinic.id]);

  const therapistName = useMemo(
    () => new Map((therapists ?? []).map((t) => [t.id, t.name])),
    [therapists]
  );

  const visitStatsByPatient = useMemo(() => {
    const map = new Map<string, { lastVisitOn: string; visitCount: number; latestVisit: Visit }>();
    for (const v of allVisits ?? []) {
      if (v.deleted) continue;
      const cur = map.get(v.patientId);
      if (!cur) {
        map.set(v.patientId, { lastVisitOn: v.visitDate, visitCount: 1, latestVisit: v });
      } else {
        cur.visitCount += 1;
        if (v.visitDate > cur.lastVisitOn) {
          cur.lastVisitOn = v.visitDate;
          cur.latestVisit = v;
        }
      }
    }
    return map;
  }, [allVisits]);

  const statusByInvoiceId = useMemo(
    () => new Map((invoicePayments ?? []).map((p) => [p.invoiceId, p.status])),
    [invoicePayments]
  );
  const directPaymentByVisitId = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of directPayments ?? []) {
      map.set(p.visitId, (map.get(p.visitId) ?? 0) + p.amountPaise);
    }
    return map;
  }, [directPayments]);

  function latestState(v: Visit) {
    return computeVisitPaymentState(
      v.actualBillPaise,
      v.invoiceId ?? null,
      directPaymentByVisitId.get(v.id) ?? 0,
      v.invoiceId ? statusByInvoiceId.get(v.invoiceId) : undefined
    );
  }

  const comparators = {
    ...PATIENT_COMPARATORS,
    lastVisit: byString<Patient>((p) => visitStatsByPatient.get(p.id)?.lastVisitOn ?? ''),
  };

  /**
   * Patient-level billing summary — lifetime billed + outstanding
   * balance across ALL of this patient's visits, not just the latest
   * one. Same "non-collected, non-zero-session visits count toward
   * outstanding" definition already trusted on PatientProfilePage's
   * billingSummary, just keyed by patient instead of scoped to one.
   */
  const billingByPatient = useMemo(() => {
    const map = new Map<string, { totalBilledPaise: number; outstandingBalancePaise: number }>();
    for (const v of allVisits ?? []) {
      if (v.deleted) continue;
      const cur = map.get(v.patientId) ?? { totalBilledPaise: 0, outstandingBalancePaise: 0 };
      cur.totalBilledPaise += v.actualBillPaise;
      const state = computeVisitPaymentState(
        v.actualBillPaise,
        v.invoiceId ?? null,
        directPaymentByVisitId.get(v.id) ?? 0,
        v.invoiceId ? statusByInvoiceId.get(v.invoiceId) : undefined
      );
      if (!isCollected(state) && state !== 'zero_session')
        cur.outstandingBalancePaise += v.actualBillPaise;
      map.set(v.patientId, cur);
    }
    return map;
  }, [allVisits, directPaymentByVisitId, statusByInvoiceId]);

  const q = query.trim().toLowerCase();
  const phoneQ = q.replace(/\D/g, '');
  const active = (all ?? []).filter((p) => {
    if (p.deletedAt) return false;
    const matchesQuery =
      !q ||
      p.mrno.toLowerCase().startsWith(q) ||
      p.name.toLowerCase().includes(q) ||
      (phoneQ.length >= 3 && (p.phone ?? '').replace(/\D/g, '').includes(phoneQ));
    if (!matchesQuery) return false;
    if (periodPatientIds !== null && !periodPatientIds.has(p.id)) return false;
    const stats = visitStatsByPatient.get(p.id);
    if (chip === 'mine') {
      return stats?.latestVisit.therapistId === myTherapistId;
    }
    if (chip === 'needs_invoice') {
      return stats
        ? paymentActions(latestState(stats.latestVisit)).includes('issue_invoice')
        : false;
    }
    return true;
  });
  const hidden = (all ?? []).filter((p) => p.deletedAt);
  const rows = applySort(active, comparators, sort);

  async function hide(p: Patient) {
    if (
      !confirm(
        `Hide ${p.name} (${p.mrno})?\n\nThey disappear from search and pickers; their visits stay in the records. You can restore them anytime from "Hidden patients" below.`
      )
    )
      return;
    setError(null);
    try {
      await patientService.hide(p.id);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  async function restore(p: Patient) {
    setError(null);
    try {
      await patientService.restore(p.id);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  async function hardDelete(p: Patient) {
    setError(null);
    try {
      const visits = await repos.visits.list({ clinicId: clinic.id, patientId: p.id });
      if (visits.length > 0) {
        alert(
          `${p.name} has ${visits.length} visit(s) on record, so they can't be permanently deleted - keep them hidden instead.`
        );
        return;
      }
      const typed = prompt(
        `Permanently delete ${p.name} (${p.mrno})? This cannot be undone.\n\nType the patient's name to confirm:`
      );
      if (typed === null) return;
      if (typed.trim().toLowerCase() !== p.name.trim().toLowerCase()) {
        alert('Name did not match - nothing was deleted.');
        return;
      }
      await patientService.hardDelete(p.id);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  return (
    <SectionCard title="All Patients">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <div className="flex gap-2">
            <select
              className={inputCls}
              value={fyStartYear}
              onChange={(e) => setFyStartYear(Number(e.target.value))}
            >
              {[currentFy.startYear - 2, currentFy.startYear - 1, currentFy.startYear].map((y) => (
                <option key={y} value={y}>
                  FY{' '}
                  {fiscalYearOf(new Date(y, clinic.fyStartMonth - 1, 1), clinic.fyStartMonth).label}
                </option>
              ))}
            </select>
            <select className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Full FY</option>
              <option value="ytd">Year to date</option>
              {months.map((m) => (
                <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                  {monthName(m.month)} {m.year}
                </option>
              ))}
              <option value="custom">Custom range…</option>
            </select>
          </div>
          {month === 'custom' && (
            <div className="flex gap-2">
              <input
                type="date"
                className={inputCls}
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="From"
              />
              <input
                type="date"
                className={inputCls}
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="To"
              />
            </div>
          )}
          <input
            className={`${inputCls} max-w-xs`}
            placeholder="Search by Patient ID, name, or phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(
          [
            { key: 'all', label: 'All' },
            { key: 'needs_invoice', label: 'Needs invoice' },
            { key: 'mine', label: 'My patients' },
          ] as const
        ).map((c) => (
          <button
            key={c.key}
            type="button"
            className={`min-h-11 rounded-full px-3 py-1 text-xs font-medium ${
              chip === c.key
                ? 'bg-[var(--teal-light)] text-[var(--teal)]'
                : 'text-[var(--muted)] hover:bg-[var(--paper)]'
            }`}
            onClick={() => setChip(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-[var(--muted)]">
        {selectedPeriod ? (
          <>
            Showing patients seen in {monthName(selectedPeriod.month)} {selectedPeriod.year}.{' '}
            <button
              type="button"
              className="font-medium text-[var(--teal)] hover:underline"
              onClick={() => setMonth('')}
            >
              Show Full FY
            </button>
          </>
        ) : month === 'ytd' ? (
          <>
            Showing patients seen since the start of FY{' '}
            {
              fiscalYearOf(new Date(fyStartYear, clinic.fyStartMonth - 1, 1), clinic.fyStartMonth)
                .label
            }
            , through today.{' '}
            <button
              type="button"
              className="font-medium text-[var(--teal)] hover:underline"
              onClick={() => setMonth('')}
            >
              Show Full FY
            </button>
          </>
        ) : month === 'custom' ? (
          customFrom && customTo ? (
            customFrom > customTo ? (
              <span className="text-[var(--rust)]">From date must be before To date.</span>
            ) : (
              <>
                Showing patients seen {formatDateDMY(customFrom)}–{formatDateDMY(customTo)}.{' '}
                <button
                  type="button"
                  className="font-medium text-[var(--teal)] hover:underline"
                  onClick={() => setMonth('')}
                >
                  Show Full FY
                </button>
              </>
            )
          ) : (
            'Pick a From and To date above.'
          )
        ) : (
          `Showing patients seen in FY ${fiscalYearOf(new Date(fyStartYear, clinic.fyStartMonth - 1, 1), clinic.fyStartMonth).label}.`
        )}
      </p>

      <ErrorNote message={error} />

      {rows.length === 0 ? (
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-8 text-center text-sm text-[var(--muted)]">
          {q
            ? 'No patients match your search.'
            : (all ?? []).filter((p) => !p.deletedAt).length === 0
              ? 'No patients yet - they\'re created from the "New visit" flow.'
              : 'No patients were seen in this period.'}
        </div>
      ) : (
        <>
          {/* Below tab: (744px) — flat rows inside SectionCard, same as visit lists. */}
          <div className="tab:hidden -mx-5 divide-y divide-[var(--border)]">
            {rows.map((p) => (
              <div key={p.id} className="px-5">
                <PatientCard
                  patient={p}
                  stats={visitStatsByPatient.get(p.id)}
                  billing={billingByPatient.get(p.id)}
                  nextAction={
                    visitStatsByPatient.get(p.id) &&
                    canBill &&
                    paymentActions(
                      latestState(visitStatsByPatient.get(p.id)!.latestVisit)
                    ).includes('issue_invoice')
                      ? 'invoice'
                      : 'visit'
                  }
                  therapistName={therapistName}
                  onEdit={() => setEditing(p)}
                  onHide={() => void hide(p)}
                />
              </div>
            ))}
          </div>

          <div className="hidden tab:block overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <table className="min-w-full divide-y divide-[var(--border)]">
              <thead className="bg-[var(--paper)]">
                <tr>
                  <SortHeader label="Patient ID" k="mrno" sort={sort} />
                  <SortHeader label="Name" k="name" sort={sort} />
                  <th className={th}>Therapist</th>
                  <SortHeader label="Primary condition" k="condition" sort={sort} />
                  <th className={th}>Treatment</th>
                  <SortHeader label="Last visit" k="lastVisit" sort={sort} firstDir="desc" />
                  <th className={th}>Bill</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((p) => {
                  const stats = visitStatsByPatient.get(p.id);
                  const billing = billingByPatient.get(p.id);
                  return (
                    <tr key={p.id} className="hover:bg-[var(--paper)]">
                      <td className={td}>
                        {p.mrno}
                        {p.mrnoSource === 'auto' && (
                          <span className="ml-1.5">
                            <Pill tone="slate">walk-in</Pill>
                          </span>
                        )}
                      </td>
                      <td className={`${td} font-display`}>
                        <Link
                          to="/patients/$patientId"
                          params={{ patientId: p.id }}
                          search={{ from: '/patients' }}
                          className="hover:underline"
                        >
                          {p.name}
                        </Link>
                        {(p.age || p.sex) && (
                          <div className="text-xs text-[var(--muted)]">
                            {p.age ?? '-'} / {p.sex ?? '-'}
                          </div>
                        )}
                      </td>
                      <td className={td}>
                        {stats?.latestVisit ? (
                          <TherapistPill>
                            {therapistName.get(stats.latestVisit.therapistId) ?? '-'}
                          </TherapistPill>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className={td}>{p.primaryCondition ?? '-'}</td>
                      <td className={td}>
                        {stats?.latestVisit?.treatmentNotes ? (
                          <span className="text-xs">{stats.latestVisit.treatmentNotes}</span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className={td}>
                        {stats ? (
                          <div className="font-num text-xs text-[var(--ink)]">
                            {formatDateDMY(stats.lastVisitOn)}
                            <span className="text-[var(--muted)]">
                              {' '}
                              · {stats.visitCount} visit{stats.visitCount === 1 ? '' : 's'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">No visits yet</span>
                        )}
                      </td>
                      <td className={`${td} text-xs`}>
                        {stats ? (
                          <>
                            <div className="font-num text-[var(--ink)]">
                              {formatINR(billing?.totalBilledPaise ?? 0)} billed
                            </div>
                            {(billing?.outstandingBalancePaise ?? 0) > 0 && (
                              <div className="mt-0.5 font-num text-[var(--rust)]">
                                {formatINR(billing!.outstandingBalancePaise)} due
                              </div>
                            )}
                          </>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        <Link
                          to="/visits/new"
                          search={{ patientId: p.id }}
                          className="text-xs font-medium text-[var(--teal)] hover:underline"
                        >
                          + Visit
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {hidden.length > 0 && (
        <div className="mt-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
            onClick={() => setShowHidden((s) => !s)}
          >
            <span>Hidden patients ({hidden.length})</span>
            <span className="text-xs text-[var(--muted)]">{showHidden ? 'Collapse' : 'Show'}</span>
          </button>
          {showHidden && (
            <table className="min-w-full divide-y divide-[var(--border)] border-t border-[var(--border)]">
              <tbody className="divide-y divide-[var(--border)]">
                {hidden.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--paper)]">
                    <td className={td}>
                      <span className="font-display">{p.name}</span>{' '}
                      <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
                    </td>
                    <td className={td}>
                      <Pill tone="slate">Hidden {p.deletedAt && formatDateDM(p.deletedAt)}</Pill>
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <button
                        type="button"
                        className="text-xs text-[var(--teal)] hover:underline"
                        onClick={() => void restore(p)}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="ml-3 text-xs text-[var(--muted)] hover:text-[var(--rust)]"
                        onClick={() => void hardDelete(p)}
                      >
                        Delete permanently
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing && (
        <EditPatientModal
          patient={editing}
          open={true}
          onClose={() => setEditing(null)}
          onSave={() => setEditing(null)}
        />
      )}
    </SectionCard>
  );
}

/** Phone-width row for the patients list — flat inside SectionCard (no nested
 *  box), matching SharedVisitCard: avatar header, full-width wrapped detail
 *  lines, footer with status + primary action. */
function PatientCard({
  patient: p,
  stats,
  billing,
  nextAction,
  therapistName,
  onEdit,
  onHide,
}: {
  patient: Patient;
  stats: { lastVisitOn: string; visitCount: number; latestVisit: Visit } | undefined;
  billing: { totalBilledPaise: number; outstandingBalancePaise: number } | undefined;
  nextAction: 'invoice' | 'visit';
  therapistName: Map<string, string>;
  onEdit: () => void;
  onHide: () => void;
}) {
  const initials = p.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  const therapistLine = stats ? therapistName.get(stats.latestVisit.therapistId) : null;

  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-2">
        <Link
          to="/patients/$patientId"
          params={{ patientId: p.id }}
          search={{ from: '/patients' }}
          className="flex min-w-0 flex-1 items-start gap-2.5"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--teal-light)] font-display text-[11px] font-semibold text-[var(--teal)]">
            {initials || '?'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-sm font-medium text-[var(--ink)]">{p.name}</div>
            <div className="text-xs leading-snug text-[var(--muted)]">
              {patientIdentityLine(p.mrno, p.age, p.sex)}
            </div>
          </div>
        </Link>
        <KebabMenu ariaLabel="Patient actions">
          {(close) => (
            <>
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  close();
                  onEdit();
                }}
              >
                Edit patient
              </button>
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  close();
                  onHide();
                }}
              >
                Hide patient
              </button>
            </>
          )}
        </KebabMenu>
      </div>

      {(p.primaryCondition || therapistLine || stats?.latestVisit?.treatmentNotes) && (
        <div className="mt-1.5 space-y-1">
          {therapistLine && (
            <CardDetailRow label="Therapist">
              <TherapistPill>{therapistLine}</TherapistPill>
            </CardDetailRow>
          )}
          {p.primaryCondition && (
            <CardDetailRow label="Condition">{p.primaryCondition}</CardDetailRow>
          )}
          {stats?.latestVisit?.treatmentNotes && (
            <CardDetailRow label="Treatment" clamp>
              {stats.latestVisit.treatmentNotes}
            </CardDetailRow>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
          {stats ? (
            <>
              <span className="font-num text-[var(--ink)]">{formatDateDMY(stats.lastVisitOn)}</span>
              <span>
                {stats.visitCount} visit{stats.visitCount === 1 ? '' : 's'}
              </span>
              <span className="font-num">{formatINR(billing?.totalBilledPaise ?? 0)} billed</span>
              {(billing?.outstandingBalancePaise ?? 0) > 0 && (
                <span className="font-num text-[var(--rust)]">
                  {formatINR(billing!.outstandingBalancePaise)} due
                </span>
              )}
            </>
          ) : (
            <span>No visits yet</span>
          )}
        </div>
        <Link
          to="/visits/new"
          search={{ patientId: p.id }}
          className={
            nextAction === 'invoice'
              ? 'rounded-full bg-[var(--teal)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--teal-strong)]'
              : 'rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper)]'
          }
        >
          {nextAction === 'invoice' ? 'Needs invoice' : '+ Visit'}
        </Link>
      </div>
    </div>
  );
}
