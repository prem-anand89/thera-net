import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { usePermissions } from '@/app/usePermissions';
import { formatINR } from '@/domain/money';
import type { TodayVisitRow } from '@/services/dashboardService';
import {
  btnPrimary,
  SectionCard,
  StatTile,
  Pill,
  PackageThread,
  th,
  thNum,
  td,
  tdNum,
} from '@/components/ui';
import { ResponsiveVisitList, type VisitCardData } from '@/components/VisitCard';
import { TakePaymentDialog } from '@/components/TakePaymentDialog';
import { IssueInvoiceDialog, type IssueInvoiceTarget } from '@/components/IssueInvoiceDialog';
import { TherapistComparisonCard } from '@/components/TherapistComparisonCard';
import { EditPatientModal } from '@/features/patients/EditPatientModal';
import { AddPatientDetailsModal } from '@/features/visits/AddPatientDetailsModal';
import { EditVisitModal } from '@/features/visits/EditVisitModal';
import { FirstWeekSetupLink } from '@/features/settings/FirstWeekChecklist';

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
  const [editPatientId, setEditPatientId] = useState<string | null>(null);
  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);
  const [, setVisitEditError] = useState<string | null>(null);
  const [newPatientId, setNewPatientId] = useState<string | null>(null);
  const [pkgStatusFilter, setPkgStatusFilter] = useState<'open' | 'stale' | 'all'>('open');
  // Defaults on for anyone with a linked therapist record — admin included,
  // since in most solo/small clinics the admin *is* the primary therapist.
  // Role plays no part here: only whether this login has a `therapists` row
  // to scope to.
  const [pkgMineOnly, setPkgMineOnly] = useState(true);

  // Staff (therapist) tier sees only their own visits in the today-scoped
  // stats and Seen today (one shared query drives both); admin sees the
  // whole clinic. While role hasn't resolved yet ('unknown'), useWorkspaceScope
  // defaults to the narrower staff-scoped view rather than flashing
  // clinic-wide data.
  const today = useLiveQuery(
    () => dashboardService.todayWorklist(clinic.id, new Date(), scope.scopeTherapistId),
    [clinic.id, scope.scopeTherapistId]
  );
  // Clinic-wide for admin/front_desk, scoped to just this therapist's own
  // visits otherwise — matches "Collected today" above, which already
  // scopes the same way via scope.scopeTherapistId.
  const monthlyNew = useLiveQuery(
    () => dashboardService.monthlyNewCounts(clinic.id, new Date(), scope.scopeTherapistId),
    [clinic.id, scope.scopeTherapistId]
  );
  // Clinic-wide open-packages list — feeds both the "My open packages" stat
  // tile and the Packages panel below, so fetched once regardless of role.
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);
  const myOpenPackageCount = useMemo(
    () => (openPackages ?? []).filter((p) => p.startedByTherapistId === scope.myTherapistId).length,
    [openPackages, scope.myTherapistId]
  );
  const openPackageGroupIds = useMemo(
    () => new Set((openPackages ?? []).map((p) => p.packageGroupId)),
    [openPackages]
  );
  const filteredPackages = useMemo(() => {
    let rows = openPackages ?? [];
    if (pkgMineOnly && scope.myTherapistId) rows = rows.filter((p) => p.startedByTherapistId === scope.myTherapistId);
    if (pkgStatusFilter !== 'all') rows = rows.filter((p) => p.stale === (pkgStatusFilter === 'stale'));
    return rows;
  }, [openPackages, pkgMineOnly, scope.myTherapistId, pkgStatusFilter]);

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
        {scope.myTherapistId ? (
          <StatTile label="My open packages" value={openPackages === undefined ? '—' : myOpenPackageCount} />
        ) : (
          <StatTile label="Packages this month" value={monthlyNew?.newPackages ?? 0} />
        )}
      </div>

      <SectionCard title={today && today.visits.length === 1 ? "Today's visit" : "Today's visits"}>
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

      <SectionCard title="Packages">
        <p className="mb-3 text-xs text-[var(--muted)]">
          Every patient on a package — who&rsquo;s still owed sessions, and whose package has gone quiet.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            {(
              [
                { key: 'open', label: 'Open' },
                { key: 'stale', label: 'Stale' },
                { key: 'all', label: 'All' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setPkgStatusFilter(opt.key)}
                className="rounded-full border px-3 py-1 text-xs font-medium"
                style={{
                  background: pkgStatusFilter === opt.key ? 'var(--teal-light)' : 'var(--surface)',
                  borderColor: pkgStatusFilter === opt.key ? 'transparent' : 'var(--border)',
                  color: pkgStatusFilter === opt.key ? 'var(--teal)' : 'var(--muted)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {scope.myTherapistId && (
            <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <input type="checkbox" checked={pkgMineOnly} onChange={(e) => setPkgMineOnly(e.target.checked)} />
              Mine only
            </label>
          )}
          <span className="text-xs text-[var(--muted)]">
            {filteredPackages.length} package{filteredPackages.length === 1 ? '' : 's'}
          </span>
        </div>
        {filteredPackages.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">No packages match this filter.</p>
        ) : (
          <>
            {/* Below tab: — same boxed-card treatment Today's visits and
                Patients use, on the same breakpoint, instead of forcing a
                7-column table to scroll sideways on a phone. */}
            <div className="tab:hidden space-y-2">
              {filteredPackages.map((p) => (
                <div
                  key={p.packageGroupId}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link to="/patients/$patientId" params={{ patientId: p.patientId }} className="min-w-0">
                      <div className="font-display text-sm font-medium text-[var(--ink)]">{p.patientName}</div>
                      <div className="text-xs text-[var(--muted)]">{p.mrno}</div>
                    </Link>
                    <Pill tone={p.stale ? 'amber' : 'green'}>{p.stale ? 'Stale' : 'Open'}</Pill>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Pill tone="slate">{p.serviceName}</Pill>
                    <Pill tone="slate">{p.startedByTherapistName}</Pill>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                      <PackageThread sessionIndex={p.sessionsLogged} packageTotal={p.packageTotal} />
                      <span className="font-num">
                        {p.sessionsLogged}/{p.packageTotal}
                      </span>
                      <span>· {p.daysSinceLastVisit}d ago</span>
                    </div>
                    <Link
                      to="/visits/new"
                      search={{ repeatVisitId: p.lastVisitId }}
                      className="rounded-full bg-[var(--teal)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
                    >
                      Log visit
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden tab:block overflow-x-auto">
              <table className="min-w-full divide-y divide-[var(--border)]">
                <thead className="bg-[var(--paper)]">
                  <tr>
                    <th className={th}>Patient</th>
                    <th className={th}>Package</th>
                    <th className={th}>Therapist</th>
                    <th className={thNum}>Sessions</th>
                    <th className={th}>Last visit</th>
                    <th className={th}>Status</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredPackages.map((p) => (
                    <tr key={p.packageGroupId}>
                      <td className={td}>
                        {p.patientName} <span className="text-[var(--muted)]">{p.mrno}</span>
                      </td>
                      <td className={td}>{p.serviceName}</td>
                      <td className={td}>{p.startedByTherapistName}</td>
                      <td className={tdNum}>
                        <span className="inline-flex items-center gap-1.5">
                          <PackageThread sessionIndex={p.sessionsLogged} packageTotal={p.packageTotal} />
                          {p.sessionsLogged} / {p.packageTotal}
                        </span>
                      </td>
                      <td className={td}>{p.daysSinceLastVisit}d ago</td>
                      <td className={td}>
                        <Pill tone={p.stale ? 'amber' : 'green'}>{p.stale ? 'Stale' : 'Open'}</Pill>
                      </td>
                      <td className={td}>
                        <Link
                          to="/visits/new"
                          search={{ repeatVisitId: p.lastVisitId }}
                          className="text-xs font-medium text-[var(--teal)] hover:underline"
                        >
                          Log visit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      {/* A plain therapist can't reach the Reports nav tab (admin/front_desk
          only, decision 3) — this is the one financial-aggregate exception
          they do get (decision 4), so it surfaces here instead. Admin and
          front_desk see it on Reports instead, not here, so it never shows
          twice. */}
      {!scope.isClinicWideView && <TherapistComparisonCard />}

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
