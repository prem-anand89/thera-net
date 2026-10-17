import { askConfirm, notify } from '@/lib/notify';
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, patientService, feedbackService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { usePermissions } from '@/app/usePermissions';
import { formatINR } from '@/domain/money';
import { computeVisitPaymentState, isCollected, paymentActions } from '@/domain/paymentState';
import { EditPatientModal } from './EditPatientModal';
import { BookSlotSheet } from '@/components/BookSlotSheet';
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
import { REFERRING_SOURCE_LABELS, type Patient, type Visit, type ReferringSourceItem } from '@/domain/types';
import { isStale } from '@/domain/packageTracking';
import {
  th,
  td,
  ErrorNote,
  Pill,
  KebabMenu,
  menuItem,
  TherapistPill,
  chipSelectChevron,
  pillPrimary,
  pillAttention,
  pillAccent,
  pillNeutral,
} from '@/components/ui';
import { Pager, usePagination } from '@/components/Pager';
import { EmptyState } from '@/components/EmptyState';
import { IconCalendar } from '@/components/NavIcons';
import { patientIdentityLine, CardDetailRow } from '@/components/VisitCard';
import { applySort, byNumber, byString, SortHeader, useSort } from '@/components/sortable';
import { toFriendlyMessage } from '@/lib/errors';

/** Just the source label ("Doctor referral"), not the "— Dr. Mehta" detail
 *  PatientProfilePage's own `referral` line adds — this is a roster-glance
 *  column, not the full record, and the detail routinely doubled the line's
 *  width. Null when nothing's on file, common for older/walk-in patients
 *  who predate the field. Full detail is still one click away on the
 *  patient's own profile. */
function patientReferralLine(p: Patient, referringSources: ReferringSourceItem[]): string | null {
  const match = p.referringSourceId
    ? referringSources.find((s) => s.id === p.referringSourceId)?.name
    : p.referringSource
      ? REFERRING_SOURCE_LABELS[p.referringSource]
      : null;
  return match ?? null;
}

type PatientSortKey = 'name' | 'mrno' | 'age' | 'condition' | 'lastVisit';
const PATIENT_COMPARATORS = {
  name: byString<Patient>((p) => p.name),
  mrno: byString<Patient>((p) => p.mrno),
  age: byNumber<Patient>((p) => p.age ?? -1),
  condition: byString<Patient>((p) => p.primaryCondition ?? ''),
};

export function PatientsList() {
  const clinic = useClinic();
  const referringSources = useLiveQuery(
    () => repos.referringSourceCatalog.list(clinic.id),
    [clinic.id]
  ) ?? [];
  const { myTherapistId, isFrontDesk } = useWorkspaceScope();
  const { canBill, isAdmin } = usePermissions();
  // create_appointment_staff (the RPC the "Book" action calls) rejects
  // anyone who isn't admin or front_desk server-side — same role check
  // Requests → Bookings' own "New booking" card is gated on
  // (`canSeeBookings` there). Without this, a therapist saw a live-looking
  // Book button that always failed with "Not authorized."
  const canBook = clinic.enablePatientComms && (isAdmin || isFrontDesk);
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<'all' | 'mine'>('all');
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [booking, setBooking] = useState<Patient | null>(null);
  const sort = useSort<PatientSortKey>('lastVisit', 'desc');

  const now = new Date();
  const currentFy = fiscalYearOf(now, clinic.fyStartMonth);
  const [fyStartYear, setFyStartYear] = useState(currentFy.startYear);
  // '' = Full FY, 'ytd' = year to date (current FY only), 'custom' = customFrom/customTo,
  // otherwise a specific "YYYY-M" month value. A long list is paged (see Pager below),
  // so the wide default doesn't bloat the page.
  const [month, setMonth] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

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
  const appointments = useLiveQuery(
    () => (canBook ? repos.appointments.listByClinic(clinic.id) : undefined),
    [canBook, clinic.id]
  );
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
    // When a search term is typed, search across the entire clinic directory;
    // otherwise scope to the selected month/fiscal year.
    if (!q && periodPatientIds !== null && !periodPatientIds.has(p.id)) return false;
    const stats = visitStatsByPatient.get(p.id);
    if (chip === 'mine') {
      return stats?.latestVisit.therapistId === myTherapistId;
    }
    return true;
  });
  const hidden = (all ?? []).filter((p) => p.deletedAt);
  const rows = applySort(active, comparators, sort);
  const pager = usePagination(
    rows,
    `${q}|${chip}|${fyStartYear}|${month}|${customFrom}|${customTo}|${sort.key}|${sort.dir}`,
    'patients'
  );

  async function hide(p: Patient) {
    const ok = await askConfirm({
      title: `Hide ${p.name} (${p.mrno})?`,
      message:
        'They disappear from search and pickers; their visits stay in the records. You can restore them anytime from "Hidden patients" below.',
      confirmLabel: 'Hide patient',
    });
    if (!ok) return;
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
        notify.error(
          `${p.name} has ${visits.length} visit(s) on record, so they can't be permanently deleted - keep them hidden instead.`
        );
        return;
      }
      const confirmed = await askConfirm({
        title: `Permanently delete ${p.name} (${p.mrno})?`,
        message: "This cannot be undone. Type the patient's name to confirm.",
        confirmLabel: 'Delete permanently',
        destructive: true,
        typeToConfirm: {
          placeholder: p.name,
          isMatch: (typed) => typed.trim().toLowerCase() === p.name.trim().toLowerCase(),
        },
      });
      if (!confirmed) return;
      await patientService.hardDelete(p.id);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  return (
    <div className="space-y-4">
      {/* The page title above already says "Patients", so no card heading.
          One toolbar: the chips on the left; search and a single period
          select (financial year + month in one) on the right. Phones: the
          chips scroll on one row, search and period share the next. */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Patient filter"
          className="hide-scrollbar flex h-10 w-fit max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1"
        >
          {(
            [
              { key: 'all', label: 'All' },
              { key: 'mine', label: 'My patients' },
            ] as const
          ).map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={chip === c.key}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                chip === c.key
                  ? 'bg-[var(--teal)] text-white shadow-sm'
                  : 'text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]'
              }`}
              onClick={() => setChip(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <div className="relative flex-1 sm:w-64 sm:flex-none">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--muted)]">
              <svg
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                className="h-4 w-4"
              >
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
                <path d="M13.5 13.5L18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <input
              type="search"
              aria-label="Search patients"
              className="h-10 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-8 text-sm text-[var(--ink)] placeholder-[var(--muted)] transition-colors hover:border-[var(--muted)] focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20 [&::-webkit-search-cancel-button]:hidden"
              placeholder="Search ID, name or phone"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
                onClick={() => setQuery('')}
              >
                ✕
              </button>
            )}
          </div>
          <select
            aria-label="Fiscal year"
            className="h-10 min-h-10 appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)] bg-[length:12px] bg-[right_10px_center] bg-no-repeat py-2 pl-3 pr-8 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--muted)] focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20"
            style={chipSelectChevron}
            value={month === 'custom' ? 'custom' : String(fyStartYear)}
            onChange={(e) => {
              if (e.target.value === 'custom') {
                setMonth('custom');
              } else {
                setFyStartYear(Number(e.target.value));
                setMonth('');
              }
            }}
          >
            {[currentFy.startYear, currentFy.startYear - 1, currentFy.startYear - 2].map((y) => {
              const label = fiscalYearOf(new Date(y, clinic.fyStartMonth - 1, 1), clinic.fyStartMonth).label;
              return (
                <option key={y} value={y}>
                  FY {label}{y === currentFy.startYear ? ' (Current)' : ''}
                </option>
              );
            })}
            <option value="custom">Custom range…</option>
          </select>
          {month !== 'custom' && (
            <select
              aria-label="Period within fiscal year"
              className="h-10 min-h-10 appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)] bg-[length:12px] bg-[right_10px_center] bg-no-repeat py-2 pl-3 pr-8 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--muted)] focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20"
              style={chipSelectChevron}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="">Full year</option>
              {fyStartYear === currentFy.startYear && <option value="ytd">Year to date</option>}
              {monthsOfFiscalYear(fyStartYear, clinic.fyStartMonth)
                .filter((m) => {
                  if (fyStartYear !== currentFy.startYear) return true;
                  return (
                    m.year < now.getFullYear() ||
                    (m.year === now.getFullYear() && m.month <= now.getMonth() + 1)
                  );
                })
                .map((m) => {
                  const isCurrent =
                    m.year === now.getFullYear() && m.month === now.getMonth() + 1;
                  return (
                    <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                      {monthName(m.month)} {m.year}{isCurrent ? ' (This month)' : ''}
                    </option>
                  );
                })}
            </select>
          )}
        </div>
      </div>
      {month === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <input
            type="date"
            className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--ink)] transition-colors hover:border-[var(--muted)] focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            aria-label="From date"
          />
          <span>–</span>
          <input
            type="date"
            className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--ink)] transition-colors hover:border-[var(--muted)] focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            aria-label="To date"
          />
          {!customFrom || !customTo ? (
            <span>Pick a From and To date.</span>
          ) : customFrom > customTo ? (
            <span className="text-[var(--rust)]">From date must be before To date.</span>
          ) : null}
        </div>
      )}

      <ErrorNote message={error} />

      {rows.length === 0 ? (
        <EmptyState
          title={
            q
              ? 'No patients match your search'
              : (all ?? []).filter((p) => !p.deletedAt).length === 0
                ? 'No patients yet'
                : 'No patients were seen in this period'
          }
          hint={
            q
              ? 'Check the spelling, or try the ID or phone number.'
              : (all ?? []).filter((p) => !p.deletedAt).length === 0
                ? 'Patients are created from the New visit flow.'
                : 'Widen the period to see everyone.'
          }
          actions={[
            ...(q ? [{ label: 'Clear search', onClick: () => setQuery('') }] : []),
            ...(!q && (all ?? []).some((p) => !p.deletedAt) && month !== ''
              ? [{ label: 'Show full year', onClick: () => setMonth('') }]
              : []),
          ]}
        />
      ) : (
        <>
          {/* Below tab: (744px) — framed card list */}
          <div className="tab:hidden overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
            {pager.visible.map((p) => (
              <div key={p.id} className="p-4 sm:p-5">
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
                  onBook={canBook ? () => setBooking(p) : undefined}
                  onRemind={
                    clinic.enablePatientComms &&
                    p.phone &&
                    visitStatsByPatient.get(p.id) &&
                    isStale(visitStatsByPatient.get(p.id)!.lastVisitOn)
                      ? () => {
                          void feedbackService
                            .sendReturnReminder(clinic.id, p.name, p.phone, clinic.name)
                            .catch((e) => notify.error(toFriendlyMessage(e)));
                        }
                      : undefined
                  }
                  referringSources={referringSources}
                />
              </div>
            ))}
          </div>

          <div className="hidden tab:block overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[900px] table-fixed divide-y divide-[var(--border)]">
              <colgroup>
                <col className="w-32" />
                <col className="w-48" />
                <col className="w-32" />
                <col className="w-36" />
                <col className="w-44" />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-44" />
              </colgroup>
              <thead className="bg-[var(--paper)]">
                <tr>
                  <SortHeader label="Patient ID" k="mrno" sort={sort} />
                  <SortHeader label="Name" k="name" sort={sort} />
                  <th className={th}>Phone</th>
                  <th className={th}>Therapist</th>
                  <SortHeader label="Primary condition" k="condition" sort={sort} />
                  <SortHeader label="Last visit" k="lastVisit" sort={sort} firstDir="desc" />
                  <th className={th}>Bill</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {pager.visible.map((p) => {
                  const stats = visitStatsByPatient.get(p.id);
                  const billing = billingByPatient.get(p.id);
                  const referral = patientReferralLine(p, referringSources);
                  return (
                    <tr key={p.id} className="hover:bg-[var(--paper)]">
                      <td className={td}>
                        {/* No walk-in/auto-MRN pill here — the mobile card
                            never had one (just patientIdentityLine's plain
                            mrno/age/sex), and this table's own referral
                            line right below already says "Walk-in" for the
                            common case where that's also how the patient
                            arrived. Showing both read as the same fact
                            twice, once as a pill and once as text. The
                            auto-vs-hospital MRN distinction is still
                            visible on the patient's own profile — this is
                            a roster-glance row, not the full record. */}
                        <div>{p.mrno}</div>
                        {/* Second line, same pattern as Name's age/sex line
                            below — referral is the one other fact worth a
                            glance at roster level, and pairing it here
                            (rather than a column of its own) keeps every
                            multi-fact cell in this table the same fixed
                            two-line shape. Always shows the actual value
                            (or '—' when nothing's on file). */}
                        <div className="text-xs text-[var(--muted)]">{referral ?? '—'}</div>
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
                      <td className={`${td} whitespace-nowrap`}>
                        {p.phone ? (
                          <a href={`tel:${p.phone}`} className="hover:underline">
                            {p.phone}
                          </a>
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
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
                      <td className={`${td} whitespace-nowrap`}>
                        {stats ? (
                          <>
                            <div className="font-num text-xs text-[var(--ink)]">
                              {formatDateDMY(stats.lastVisitOn)}
                            </div>
                            <div className="text-xs text-[var(--muted)]">
                              {stats.visitCount} visit{stats.visitCount === 1 ? '' : 's'}
                            </div>
                          </>
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
                        {/* Bordered pills, not plain text links — two bare
                            underlined links in the same teal sat flush
                            against each other with nothing marking where
                            one ended and the other began, reading as one
                            run-on "+ Visit Book" phrase. A visible edge
                            per button (same pill shape the phone card
                            already uses for these two) fixes that
                            regardless of color. */}
                        <div className="flex items-center gap-1.5">
                          <Link
                            to="/visits/new"
                            search={{ patientId: p.id, from: '/patients' }}
                            className={pillPrimary}
                          >
                            + Visit
                          </Link>
                          {canBook && (
                            <button
                              type="button"
                              className={pillAccent}
                              onClick={() => setBooking(p)}
                            >
                              <IconCalendar className="h-3.5 w-3.5" />
                              Book
                            </button>
                          )}
                          {/* Same re-engagement nudge Reports → "Single-visit
                              patients" already offers, surfaced here too so
                              front desk doesn't need a detour through Reports
                              for a patient they're already looking at. Same
                              "stale" threshold as the package follow-up
                              queue (STALE_PACKAGE_DAYS) — no visits yet
                              never qualifies, there's nothing to follow up
                              on. */}
                          {clinic.enablePatientComms &&
                            p.phone &&
                            stats &&
                            isStale(stats.lastVisitOn) && (
                              <button
                                type="button"
                                className={pillNeutral}
                                onClick={() => {
                                  void feedbackService
                                    .sendReturnReminder(clinic.id, p.name, p.phone, clinic.name)
                                    .catch((e) => notify.error(toFriendlyMessage(e)));
                                }}
                              >
                                Remind
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager list={pager} noun="patients" />
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
            // A plain wrapping flex list, not a table — three simple pieces
            // of content per row (name, status pill, two actions) that flow
            // fine at any width, rather than a 3-column table forcing
            // horizontal scroll on a phone. Actions get real padding (not
            // bare text with a small ml-3 gap) so Restore and the
            // destructive Delete permanently aren't easy to mis-tap into
            // each other.
            <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
              {hidden.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 hover:bg-[var(--paper)]"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="text-sm">
                      <span className="font-display">{p.name}</span>{' '}
                      <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
                    </span>
                    <Pill tone="slate">Hidden {p.deletedAt && formatDateDM(p.deletedAt)}</Pill>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--teal)] hover:bg-[var(--teal-light)]"
                      onClick={() => void restore(p)}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--rust-light)] hover:text-[var(--rust)]"
                      onClick={() => void hardDelete(p)}
                    >
                      Delete permanently
                    </button>
                  </div>
                </div>
              ))}
            </div>
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

      {/* Same sheet as the Schedule page; the therapist who saw them last is
          pre-picked, since front desk usually wants "same as before". */}
      <BookSlotSheet
        isOpen={booking !== null}
        onClose={() => setBooking(null)}
        appointments={appointments ?? []}
        prefilledPatientId={booking?.id}
        prefilledTherapistId={booking ? visitStatsByPatient.get(booking.id)?.latestVisit.therapistId ?? undefined : undefined}
      />
    </div>
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
  onBook,
  onRemind,
  referringSources,
}: {
  patient: Patient;
  stats: { lastVisitOn: string; visitCount: number; latestVisit: Visit } | undefined;
  billing: { totalBilledPaise: number; outstandingBalancePaise: number } | undefined;
  nextAction: 'invoice' | 'visit';
  therapistName: Map<string, string>;
  onEdit: () => void;
  onHide: () => void;
  /** Omitted (not just a no-op) when clinic.enablePatientComms is off,
   *  so the button itself doesn't show — same gate as Requests → Bookings. */
  onBook?: () => void;
  /** Omitted when the patient isn't stale (no visits, or last one within
   *  STALE_PACKAGE_DAYS) or has no phone on file — same gating as onBook. */
  onRemind?: () => void;
  referringSources: ReferringSourceItem[];
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

      {(p.phone || p.primaryCondition || therapistLine || patientReferralLine(p, referringSources)) && (
        <div className="mt-1.5 space-y-1">
          {p.phone && (
            <CardDetailRow label="Phone">
              <a href={`tel:${p.phone}`} className="hover:underline">
                {p.phone}
              </a>
            </CardDetailRow>
          )}
          {patientReferralLine(p, referringSources) && (
            <CardDetailRow label="Referral">{patientReferralLine(p, referringSources)}</CardDetailRow>
          )}
          {therapistLine && (
            <CardDetailRow label="Therapist">
              <TherapistPill>{therapistLine}</TherapistPill>
            </CardDetailRow>
          )}
          {p.primaryCondition && (
            <CardDetailRow label="Condition">{p.primaryCondition}</CardDetailRow>
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
        <div className="flex items-center gap-2">
          {onBook && (
            <button
              type="button"
              className={pillAccent}
              onClick={onBook}
            >
              <IconCalendar className="h-3.5 w-3.5" />
              Book
            </button>
          )}
          {onRemind && (
            <button
              type="button"
              className={pillNeutral}
              onClick={onRemind}
            >
              Remind
            </button>
          )}
          {nextAction === 'invoice' ? (
            // Opens this patient's visits in the Ledger, where the Invoice action lives.
            <Link to="/ledger" search={{ tab: 'visits', patientId: p.id }} className={pillAttention}>
              Needs invoice
            </Link>
          ) : (
            <Link to="/visits/new" search={{ patientId: p.id, from: '/patients' }} className={pillPrimary}>
              + Visit
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
