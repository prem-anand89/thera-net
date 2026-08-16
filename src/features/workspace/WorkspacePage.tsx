import { useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  repos,
  dashboardService,
  invoiceService,
  paymentService,
  directPaymentService,
  expectedVisitsService,
} from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { usePermissions } from '@/app/usePermissions';
import { formatINR } from '@/domain/money';
import type { ExpectedVisit, PaymentMethod, PaymentMode } from '@/domain/types';
import type { PendingWorkItem, TodayVisitRow } from '@/services/dashboardService';
import {
  btnPrimary,
  btnSecondary,
  inputCls,
  ErrorNote,
  Field,
  SectionCard,
  StatTile,
  Panel,
} from '@/components/ui';
import { ResponsiveVisitList, type VisitCardData } from '@/components/VisitCard';
import { TherapistComparisonCard } from '@/components/TherapistComparisonCard';
import { toFriendlyMessage } from '@/lib/errors';
import { EditPatientModal } from '@/features/patients/EditPatientModal';
import { AddPatientDetailsModal } from '@/features/visits/AddPatientDetailsModal';

const PAYMENT_MODES: PaymentMode[] = ['Cash', 'Card', 'UPI', 'Insurance'];
const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
];

/** What the invoice-issuance modal needs, independent of which card opened it. */
interface InvoicingTarget {
  visitId: string;
  patientLabel: string;
  serviceLabel: string;
  isPackage: boolean;
}

function todayRowToCardData(
  row: TodayVisitRow,
  openPackageGroupIds: Set<string>,
  isAdmin: boolean,
  myTherapistId: string | undefined,
  canViewClinicalNotes: boolean
): VisitCardData {
  return {
    visitId: row.visitId,
    visitDate: new Date().toISOString().slice(0, 10),
    patientId: row.patientId,
    patientName: row.patientName,
    mrno: row.mrno,
    condition: row.condition,
    serviceName: row.serviceName,
    sessionIndex: row.sessionIndex,
    packageTotal: row.packageTotal,
    therapistName: row.therapistName,
    treatmentNotes: row.treatmentNotes,
    billPaise: row.billPaise,
    paymentState: row.paymentState,
    invoiceId: row.invoiceId,
    canRepeat: Boolean(row.packageGroupId && openPackageGroupIds.has(row.packageGroupId)),
    // Pre-flight mirror of visits_delete's RLS check (is_clinic_admin or
    // is_own_therapist). front_desk is never either, so this always comes
    // out false for them — matching RLS, which rejects their delete too.
    canDelete: !row.invoiceId && (isAdmin || row.therapistId === myTherapistId),
    needsNote: row.needsNote,
    canViewNotes: canViewClinicalNotes,
    consultationNoteId: row.consultationNoteId,
  };
}

export function WorkspacePage() {
  const clinic = useClinic();
  const scope = useWorkspaceScope();
  const { canBill, canViewClinicalNotes } = usePermissions();
  const [invoicing, setInvoicing] = useState<InvoicingTarget | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [paidNow, setPaidNow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [addingExpected, setAddingExpected] = useState(false);
  const [expectedQuery, setExpectedQuery] = useState('');
  const [expectedPatientId, setExpectedPatientId] = useState<string | null>(null);
  const [expectedTimeNote, setExpectedTimeNote] = useState('');
  const [editPatientId, setEditPatientId] = useState<string | null>(null);
  const [newPatientId, setNewPatientId] = useState<string | null>(null);
  const navigate = useNavigate();

  // Staff (therapist) tier sees only their own visits in the today-scoped
  // stats and Seen today (one shared query drives both); admin sees the
  // whole clinic. While role hasn't resolved yet ('unknown'), useWorkspaceScope
  // defaults to the narrower staff-scoped view rather than flashing
  // clinic-wide data. Needs-attention and Documentation stay clinic-wide
  // for everyone — those are billing/documentation follow-ups an admin
  // needs full visibility into regardless of who logged the visit.
  const today = useLiveQuery(
    () => dashboardService.todayWorklist(clinic.id, new Date(), scope.scopeTherapistId),
    [clinic.id, scope.scopeTherapistId]
  );
  const pendingWork = useLiveQuery(() => dashboardService.pendingWork(clinic.id), [clinic.id]);
  const monthlyNew = useLiveQuery(() => dashboardService.monthlyNewCounts(clinic.id), [clinic.id]);
  // Only fetched for the "My open packages" / "My sessions this week"
  // tiles, which only render for a non-admin — cheap to skip entirely
  // once role has resolved to admin.
  const openPackages = useLiveQuery(
    () => (scope.isAdmin ? undefined : dashboardService.openPackages(clinic.id)),
    [clinic.id, scope.isAdmin]
  );
  const myOpenPackageCount = useMemo(
    () => (openPackages ?? []).filter((p) => p.startedByTherapistId === scope.myTherapistId).length,
    [openPackages, scope.myTherapistId]
  );
  const myWeekly = useLiveQuery(
    () =>
      scope.isAdmin || !scope.myTherapistId
        ? undefined
        : dashboardService.weeklySummary(clinic.id, new Date(), scope.myTherapistId),
    [clinic.id, scope.isAdmin, scope.myTherapistId]
  );
  const openPackageGroupIds = useMemo(
    () => new Set<string>(),
    []
  );
  // incomplete_note items, grouped by patient for the Documentation panel.
  // pendingWork is already sorted most-overdue-first, so the first item seen
  // per patient during this pass is their oldest pending note — no separate
  // sort needed, Map insertion order carries it through.
  const notesPending = useMemo(() => {
    const byPatient = new Map<
      string,
      { patientId: string; patientName: string; mrno: string; count: number; oldestVisitId: string; daysSince: number }
    >();
    for (const item of pendingWork ?? []) {
      if (item.kind !== 'incomplete_note' || !item.patientId || !item.visitId) continue;
      const existing = byPatient.get(item.patientId);
      if (existing) {
        existing.count += 1;
      } else {
        byPatient.set(item.patientId, {
          patientId: item.patientId,
          patientName: item.patientName,
          mrno: item.mrno,
          count: 1,
          oldestVisitId: item.visitId,
          daysSince: item.daysSince,
        });
      }
    }
    return [...byPatient.values()];
  }, [pendingWork]);

  const expectedToday = useLiveQuery(
    () => (clinic.enableExpectedToday ? expectedVisitsService.listForToday(clinic.id) : undefined),
    [clinic.id, clinic.enableExpectedToday]
  );
  const expectedMatches = useLiveQuery(
    () => (expectedQuery.trim() && !expectedPatientId ? repos.patients.search(clinic.id, expectedQuery) : []),
    [clinic.id, expectedQuery, expectedPatientId]
  );
  const allPatientsForExpected = useLiveQuery(
    () => (clinic.enableExpectedToday ? repos.patients.list(clinic.id) : undefined),
    [clinic.id, clinic.enableExpectedToday]
  );
  const editPatient = useLiveQuery(() => (editPatientId ? repos.patients.get(editPatientId) : undefined), [editPatientId]);
  const expectedPatientById = useMemo(
    () => new Map((allPatientsForExpected ?? []).map((p) => [p.id, p])),
    [allPatientsForExpected]
  );

  async function addExpected() {
    if (expectedPatientId) {
      await expectedVisitsService.add({ clinicId: clinic.id, patientId: expectedPatientId, timeNote: expectedTimeNote });
    } else if (expectedQuery.trim()) {
      await expectedVisitsService.add({ clinicId: clinic.id, patientName: expectedQuery.trim(), timeNote: expectedTimeNote });
    } else {
      return;
    }
    setExpectedQuery('');
    setExpectedPatientId(null);
    setExpectedTimeNote('');
    setAddingExpected(false);
  }

  function openExpectedVisit(entry: ExpectedVisit) {
    if (entry.patientId) {
      void navigate({ to: '/visits/new', search: { patientId: entry.patientId } });
    } else {
      void navigate({ to: '/visits/new', search: { prefillName: entry.patientName ?? '' } });
    }
  }

  async function issue() {
    if (!invoicing) return;
    setBusy(true);
    setError(null);
    try {
      const invoice = await invoiceService.issueForVisit(invoicing.visitId, paymentMode);
      try {
        await paymentService.setStatus(invoice.id, clinic.id, paidNow ? 'paid' : 'outstanding');
      } catch (statusError) {
        // Non-fatal: the invoice IS issued, and a missing status row reads
        // as Paid — correctable anytime from Ledger's Invoices tab.
        console.error('Could not record payment status', statusError);
      }
      setInvoicing(null);
      void navigate({ to: '/invoices/$invoiceId/print', params: { invoiceId: invoice.id } });
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function openInvoiceFor(data: VisitCardData) {
    setError(null);
    setPaidNow(true);
    setInvoicing({
      visitId: data.visitId,
      patientLabel: data.patientName,
      serviceLabel: data.serviceName,
      isPackage: data.packageTotal != null,
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Workspace</h1>
        <Link to="/visits/new" className={`${btnPrimary} w-full text-center sm:w-auto`}>
          + New visit
        </Link>
      </div>

      {scope.isUnlinkedTherapist && (
        <ErrorNote message="Your login isn't linked to a therapist record yet, so today's visits and packages aren't showing here. Ask your admin to set it from Settings → Team → Service roster → Linked login." />
      )}

      {/* One compact row, not two stacked grids — auto-fill sizes every
          tile off the same column width, so a wrapped last item stays
          tile-sized instead of a flex-wrap row's last (lonely) item
          stretching to fill the whole row on its own. Each StatTile is
          small enough that even 5 of them fit densely on a phone instead
          of stacking one-per-row and pushing everything else off screen. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(86px,1fr))] gap-2">
        {clinic.enableExpectedToday && <StatTile label="Expected" value={expectedToday?.length ?? 0} />}
        <StatTile label="Collected today" value={formatINR(today?.collectedPaise ?? 0)} />
        <StatTile label="New patients this month" value={monthlyNew?.newPatients ?? 0} />
        {scope.isClinicWideView ? (
          <StatTile label="Packages this month" value={monthlyNew?.newPackages ?? 0} />
        ) : (
          <>
            <StatTile label="My open packages" value={openPackages === undefined ? '—' : myOpenPackageCount} />
            <StatTile label="My sessions this week" value={myWeekly?.visitCount ?? 0} />
          </>
        )}
      </div>

      {/* A compact preview, not the full actionable row (PendingWorkRow) —
          that stays reserved for the Panel bottom-sheet below, where there's
          room for its inline "Mark paid"/"Add note" actions. Same treatment
          at every width and for every role (this used to split into an
          admin-only full-width grid at tab: and up vs. a tap-to-open chip
          everywhere else) so "needs attention" is always glanceable on the
          page itself, never hidden behind a tap, without the old grid's
          per-row padding eating most of a tablet screen. */}
      {pendingWork && pendingWork.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-[var(--ink)]">Needs attention</h2>
            {pendingWork.length > 3 && (
              <button
                type="button"
                className="text-xs font-medium text-[var(--teal)] hover:underline"
                onClick={() => setAttentionOpen(true)}
              >
                View all {pendingWork.length}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {pendingWork.slice(0, 3).map((item, i) => (
              <NeedsAttentionPreviewCard key={i} item={item} onClick={() => setAttentionOpen(true)} />
            ))}
          </div>
        </div>
      )}

      {/* List only — the manual "+ Add expected" entry form lives in its
          own card near the bottom of the page (see AddExpectedCard) instead
          of tacked onto this one, so this stays a short glanceable list at
          the top instead of growing by a whole form's height every time
          someone's mid-entry. */}
      {clinic.enableExpectedToday && (
        <SectionCard title="Expected today">
          {(expectedToday ?? []).length === 0 && (
            <p className="text-sm text-[var(--muted)]">Nobody expected yet today.</p>
          )}
          {expectedToday && expectedToday.length > 0 && (
            <ul className="divide-y divide-[var(--border)]">
              {expectedToday.map((entry) => {
                const linked = entry.patientId ? expectedPatientById.get(entry.patientId) : undefined;
                const name = linked?.name ?? entry.patientName ?? 'Unnamed';
                return (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openExpectedVisit(entry)}>
                      <span className="font-display text-[var(--ink)]">{name}</span>
                      {entry.status !== 'expected' && (
                        <span className="ml-2 text-xs text-[var(--muted)]">({entry.status})</span>
                      )}
                      <div className="text-xs text-[var(--muted)]">
                        {[entry.timeNote, linked?.primaryCondition, linked?.phone].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </button>
                    {entry.status === 'expected' && (
                      <div className="flex shrink-0 gap-2 text-xs">
                        <button
                          type="button"
                          className="text-[var(--moss)] hover:underline"
                          onClick={() => void expectedVisitsService.setStatus(entry, 'arrived')}
                        >
                          Arrived
                        </button>
                        <button
                          type="button"
                          className="text-[var(--muted)] hover:underline"
                          onClick={() => void expectedVisitsService.setStatus(entry, 'no-show')}
                        >
                          No-show
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      )}

      <SectionCard title="Seen today">
        {!today || today.visits.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No visits logged today — log one with &ldquo;+ New visit&rdquo;.
          </p>
        ) : (
          <ResponsiveVisitList
            rows={today.visits.map((row) =>
              todayRowToCardData(row, openPackageGroupIds, scope.isAdmin, scope.myTherapistId, canViewClinicalNotes)
            )}
            showDate={false}
            showPatient={true}
            onInvoice={(row) => openInvoiceFor(row)}
            onEditPatient={(row) => setEditPatientId(row.patientId)}
            onDelete={(row) => {
              if (confirm('Delete this visit?')) void repos.visits.softDelete(row.visitId);
            }}
            canInvoice={canBill}
          />
        )}
      </SectionCard>

      {clinic.clinicalDocsEnabled && notesPending.length > 0 && (
        <SectionCard title="Documentation">
          <ul className="divide-y divide-[var(--border)]">
            {notesPending.map((p) => (
              <li key={p.patientId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <span className="font-display text-[var(--ink)]">{p.patientName}</span>{' '}
                  <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    {p.count} visit{p.count === 1 ? '' : 's'} awaiting notes · oldest {p.daysSince}d
                  </span>
                </div>
                <Link
                  to="/patients/$patientId/notes/new"
                  params={{ patientId: p.patientId }}
                  search={{ visitId: p.oldestVisitId }}
                  className="text-xs font-medium text-[var(--amber)] hover:underline"
                >
                  Add note
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* A plain therapist can't reach the Reports nav tab (admin/front_desk
          only, decision 3) — this is the one financial-aggregate exception
          they do get (decision 4), so it surfaces here instead. Admin and
          front_desk see it on Reports instead, not here, so it never shows
          twice. */}
      {!scope.isClinicWideView && <TherapistComparisonCard />}

      {/* Manual entry for "Expected today" — placed last since it's the
          page's least time-sensitive action (logging who to expect, not
          reacting to who's here), and keeping it out of the way here is
          what lets the list itself stay short at the top. This whole card
          is a placeholder for a real appointment-booking system: once one
          exists, "Expected today" should populate itself from confirmed
          bookings for the day and this manual add becomes the fallback for
          walk-ins/phone bookings only, not the only path in. */}
      {clinic.enableExpectedToday && (
        <SectionCard title="Add an expected visit">
          {addingExpected ? (
            <div className="space-y-2">
              <input
                className={inputCls}
                placeholder="Patient ID/name, or type a new name"
                value={expectedQuery}
                onChange={(e) => {
                  setExpectedQuery(e.target.value);
                  setExpectedPatientId(null);
                }}
                autoFocus
              />
              {!expectedPatientId && expectedQuery.trim() && (expectedMatches ?? []).length > 0 && (
                <div className="space-y-1">
                  {(expectedMatches ?? []).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-md border border-[var(--border)] px-3 py-1.5 text-left text-sm hover:bg-[var(--paper)]"
                      onClick={() => {
                        setExpectedPatientId(p.id);
                        setExpectedQuery(p.name);
                      }}
                    >
                      <span>{p.name}</span>
                      <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
                    </button>
                  ))}
                </div>
              )}
              <input
                className={inputCls}
                placeholder="Time note (e.g. Around 4pm) — optional"
                value={expectedTimeNote}
                onChange={(e) => setExpectedTimeNote(e.target.value)}
              />
              <div className="flex gap-2">
                <button className={btnPrimary} disabled={!expectedQuery.trim()} onClick={() => void addExpected()}>
                  Add
                </button>
                <button
                  className={btnSecondary}
                  onClick={() => {
                    setAddingExpected(false);
                    setExpectedQuery('');
                    setExpectedPatientId(null);
                    setExpectedTimeNote('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className={btnSecondary} onClick={() => setAddingExpected(true)}>
              + Add expected
            </button>
          )}
        </SectionCard>
      )}

      <Panel open={attentionOpen} onClose={() => setAttentionOpen(false)} title="Needs attention">
        <ul className="divide-y divide-[var(--border)]">
          {(pendingWork ?? []).map((item, i) => (
            <PendingWorkRow key={i} item={item} clinicId={clinic.id} />
          ))}
        </ul>
      </Panel>

      {invoicing && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-3 sm:p-4">
          <div className="w-full max-w-sm space-y-4 rounded-[10px] bg-[var(--surface)] p-4 sm:p-5 max-h-[90vh] overflow-y-auto">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Issue invoice</h2>
            <p className="text-sm text-[var(--muted)]">
              {invoicing.patientLabel} — {invoicing.serviceLabel}
              {invoicing.isPackage && ', all sessions of this package'}
            </p>
            <Field label="Payment mode">
              <select
                className={inputCls}
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={paidNow} onChange={() => setPaidNow(true)} />
                Paid now
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={!paidNow} onChange={() => setPaidNow(false)} />
                Outstanding — pay later
              </label>
            </div>
            <ErrorNote message={error} />
            <p className="text-xs text-[var(--muted)]">
              The invoice number is issued by the server and the bill becomes immutable — this
              needs a connection and cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setInvoicing(null)}>
                Cancel
              </button>
              <button className={btnPrimary} disabled={busy} onClick={() => void issue()}>
                {busy ? 'Issuing…' : 'Issue invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editPatientId && editPatient && (
        <EditPatientModal
          patient={editPatient}
          open={true}
          onClose={() => setEditPatientId(null)}
          onSave={() => {
            setEditPatientId(null);
          }}
        />
      )}

      {newPatientId && (
        <AddPatientDetailsModal
          patientId={newPatientId}
          onClose={() => setNewPatientId(null)}
          onOpenEdit={() => setEditPatientId(newPatientId)}
        />
      )}
    </div>
  );
}

/** Glance-only card for the top-of-page preview — tapping it opens the
 *  Panel bottom-sheet where PendingWorkRow's actual actions live, rather
 *  than cramming "Mark paid"/"Add note" buttons into a card this narrow. */
function NeedsAttentionPreviewCard({ item, onClick }: { item: PendingWorkItem; onClick: () => void }) {
  const badge = PENDING_KIND[item.kind];
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border-y border-r border-[var(--border)] bg-[var(--surface)] py-2 pl-2.5 pr-3 text-left shadow-sm"
      style={{ borderLeft: `3px solid ${badge.fg}` }}
    >
      <div className="text-[10px] font-medium" style={{ color: badge.fg }}>
        {badge.label(item)}
      </div>
      <div className="mt-0.5 truncate text-sm font-medium text-[var(--ink)]">{item.patientName}</div>
      <div className="truncate text-xs text-[var(--muted)]">{item.detail}</div>
    </button>
  );
}

const PENDING_KIND: Record<PendingWorkItem['kind'], { bg: string; fg: string; label: (item: PendingWorkItem) => string }> = {
  outstanding_payment: { bg: 'var(--rust-light)', fg: 'var(--rust)', label: (item) => `Pending · ${item.daysSince}d` },
  stale_package: { bg: 'var(--amber-light)', fg: 'var(--amber)', label: (item) => `${item.daysSince}d since last visit` },
  incomplete_note: { bg: 'var(--paper)', fg: 'var(--muted)', label: () => 'Note not finished' },
};

function PendingWorkRow({ item, clinicId }: { item: PendingWorkItem; clinicId: string }) {
  const [choosingMethod, setChoosingMethod] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const badge = PENDING_KIND[item.kind];

  async function markInvoicePaid() {
    if (!item.invoiceId) return;
    setBusy(true);
    try {
      await paymentService.setStatus(item.invoiceId, clinicId, 'paid');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDirectPayment() {
    if (!item.visitId || item.amountPaise == null) return;
    setBusy(true);
    try {
      await directPaymentService.logPayment(
        clinicId,
        item.visitId,
        item.amountPaise,
        method,
        new Date().toISOString().slice(0, 10),
        null
      );
      setChoosingMethod(false);
    } finally {
      setBusy(false);
    }
  }

  const canMarkPaid = item.kind === 'outstanding_payment' && (item.invoiceId != null || item.visitId != null);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ background: badge.bg, color: badge.fg }}
        >
          {badge.label(item)}
        </span>
        <span className="font-display">{item.patientName}</span>
        <span className="text-xs text-[var(--muted)]">{item.mrno}</span>
        <span className="text-[var(--muted)]">{item.detail}</span>
      </div>
      <div className="flex items-center gap-3">
        {item.amountPaise != null && (
          <span className="font-num text-xs font-semibold text-[var(--rust)]">
            {formatINR(item.amountPaise)}
          </span>
        )}
        {canMarkPaid && !choosingMethod && (
          <button
            type="button"
            className="text-xs font-medium text-[var(--moss)] hover:underline"
            disabled={busy}
            onClick={() => (item.invoiceId ? void markInvoicePaid() : setChoosingMethod(true))}
          >
            Mark paid
          </button>
        )}
        {choosingMethod && (
          <span className="flex items-center gap-1.5">
            <select
              className={`${inputCls} py-1 text-xs`}
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="text-xs font-medium text-[var(--moss)] hover:underline"
              disabled={busy}
              onClick={() => void confirmDirectPayment()}
            >
              Confirm
            </button>
            <button
              type="button"
              className="text-xs text-[var(--muted)] hover:underline"
              onClick={() => setChoosingMethod(false)}
            >
              Cancel
            </button>
          </span>
        )}
        {item.kind === 'incomplete_note' && item.patientId && item.visitId && (
          <Link
            to="/patients/$patientId/notes/new"
            params={{ patientId: item.patientId }}
            search={{ visitId: item.visitId }}
            className="text-xs font-medium text-[var(--amber)] hover:underline"
          >
            Add note
          </Link>
        )}
        {item.patientId && (
          <Link
            to="/patients/$patientId"
            params={{ patientId: item.patientId }}
            className="text-xs font-medium text-[var(--teal)] hover:underline"
          >
            View
          </Link>
        )}
      </div>
    </li>
  );
}
