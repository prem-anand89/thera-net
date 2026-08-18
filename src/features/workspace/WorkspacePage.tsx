import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  repos,
  dashboardService,
  paymentService,
  directPaymentService,
} from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { usePermissions } from '@/app/usePermissions';
import { formatINR } from '@/domain/money';
import type { PaymentMethod } from '@/domain/types';
import type { PendingWorkItem, TodayVisitRow } from '@/services/dashboardService';
import {
  btnPrimary,
  inputCls,
  SectionCard,
  StatTile,
  Panel,
} from '@/components/ui';
import { ResponsiveVisitList, type VisitCardData } from '@/components/VisitCard';
import { TakePaymentDialog } from '@/components/TakePaymentDialog';
import { ShowUpiQrButton } from '@/components/UpiQrModal';
import { IssueInvoiceDialog, type IssueInvoiceTarget } from '@/components/IssueInvoiceDialog';
import { TherapistComparisonCard } from '@/components/TherapistComparisonCard';
import { EditPatientModal } from '@/features/patients/EditPatientModal';
import { AddPatientDetailsModal } from '@/features/visits/AddPatientDetailsModal';
import { EditVisitModal } from '@/features/visits/EditVisitModal';
import { FirstWeekSetupLink } from '@/features/settings/FirstWeekChecklist';

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
];

/** What the invoice-issuance modal needs, independent of which card opened it. */
type InvoicingTarget = IssueInvoiceTarget;

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
    age: row.age,
    sex: row.sex,
    condition: row.condition,
    canEdit: isAdmin || row.therapistId === myTherapistId,
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
  const { canBill, canViewClinicalNotes, canEditSettings } = usePermissions();
  const [invoicing, setInvoicing] = useState<InvoicingTarget | null>(null);
  const [takingPayment, setTakingPayment] = useState<VisitCardData | null>(null);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [editPatientId, setEditPatientId] = useState<string | null>(null);
  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);
  const [, setVisitEditError] = useState<string | null>(null);
  const [newPatientId, setNewPatientId] = useState<string | null>(null);

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
  // Clinic-wide for admin/front_desk, scoped to just this therapist's own
  // visits otherwise — matches "Collected today" above, which already
  // scopes the same way via scope.scopeTherapistId.
  const monthlyNew = useLiveQuery(
    () => dashboardService.monthlyNewCounts(clinic.id, new Date(), scope.scopeTherapistId),
    [clinic.id, scope.scopeTherapistId]
  );
  // Only fetched for the "My open packages" tile, which only renders for a
  // non-admin — cheap to skip entirely once role has resolved to admin.
  const openPackages = useLiveQuery(
    () => (scope.isAdmin ? undefined : dashboardService.openPackages(clinic.id)),
    [clinic.id, scope.isAdmin]
  );
  const myOpenPackageCount = useMemo(
    () => (openPackages ?? []).filter((p) => p.startedByTherapistId === scope.myTherapistId).length,
    [openPackages, scope.myTherapistId]
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

  const editPatient = useLiveQuery(() => (editPatientId ? repos.patients.get(editPatientId) : undefined), [editPatientId]);

  function openInvoiceFor(data: VisitCardData) {
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
        <div>
          <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Workspace</h1>
          {canEditSettings && <FirstWeekSetupLink />}
        </div>
        <Link to="/visits/new" className={`${btnPrimary} hidden text-center sm:inline-flex`}>
          + New visit
        </Link>
      </div>

      {scope.isUnlinkedTherapist && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="font-display text-base font-semibold text-[var(--ink)]">Link your login</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Today’s visits and packages aren’t showing because this login isn’t linked to a therapist
            record yet. Ask your admin to set it from Settings → Team → Linked login.
          </p>
        </section>
      )}

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Collected today" value={formatINR(today?.collectedPaise ?? 0)} />
        <StatTile label="New patients this month" value={monthlyNew?.newPatients ?? 0} />
        {scope.isClinicWideView ? (
          <StatTile label="Packages this month" value={monthlyNew?.newPackages ?? 0} />
        ) : (
          <StatTile label="My open packages" value={openPackages === undefined ? '—' : myOpenPackageCount} />
        )}
      </div>

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
            onTakePayment={(row) => setTakingPayment(row)}
            onEditPatient={(row) => setEditPatientId(row.patientId)}
            onEdit={(row) => {
              setVisitEditError(null);
              setEditingVisitId(row.visitId);
            }}
            onDelete={(row) => {
              if (confirm('Delete this visit?')) void repos.visits.softDelete(row.visitId);
            }}
            canInvoice={canBill}
          />
        )}
      </SectionCard>

      {pendingWork && (
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left shadow-sm"
          onClick={() => setAttentionOpen(true)}
        >
          <span className="font-display text-sm font-semibold text-[var(--ink)]">Needs attention</span>
          <span className="text-sm text-[var(--muted)]">
            {pendingWork.length === 0 ? 'Nothing waiting' : pendingWork.length}
          </span>
        </button>
      )}

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

      <Panel open={attentionOpen} onClose={() => setAttentionOpen(false)} title="Needs attention">
        <ul className="divide-y divide-[var(--border)]">
          {(pendingWork ?? []).map((item, i) => (
            <PendingWorkRow key={i} item={item} clinicId={clinic.id} />
          ))}
        </ul>
      </Panel>

      {invoicing && (
        <IssueInvoiceDialog clinicId={clinic.id} target={invoicing} onClose={() => setInvoicing(null)} />
      )}

      {takingPayment && (
        <TakePaymentDialog
          clinicId={clinic.id}
          visitId={takingPayment.visitId}
          invoiceId={takingPayment.invoiceId}
          amountPaise={takingPayment.billPaise}
          visitDate={takingPayment.visitDate}
          patientLabel={takingPayment.patientName}
          mrno={takingPayment.mrno}
          onClose={() => setTakingPayment(null)}
        />
      )}

      {editingVisitId && (
        <EditVisitModal
          visitId={editingVisitId}
          onClose={() => setEditingVisitId(null)}
          setError={setVisitEditError}
        />
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

  async function confirmCollection() {
    setBusy(true);
    try {
      if (item.invoiceId) {
        await paymentService.setStatus(item.invoiceId, clinicId, 'paid');
      } else if (item.visitId && item.amountPaise != null) {
        await directPaymentService.logPayment(
          clinicId,
          item.visitId,
          item.amountPaise,
          method,
          new Date().toISOString().slice(0, 10),
          null
        );
      }
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
            onClick={() => setChoosingMethod(true)}
          >
            Mark collected
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
            {method === 'upi' && item.amountPaise != null && (
              <ShowUpiQrButton
                amountPaise={item.amountPaise}
                mrno={item.mrno}
                visitDate={new Date().toISOString().slice(0, 10)}
                patientName={item.patientName}
              />
            )}
            <button
              type="button"
              className="text-xs font-medium text-[var(--moss)] hover:underline"
              disabled={busy}
              onClick={() => void confirmCollection()}
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
