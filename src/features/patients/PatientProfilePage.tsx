import { useMemo, useState, useCallback } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, consultationNoteService, invoiceService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { Pill, btnPrimary, btnSecondary } from '@/components/ui';
import { SharedVisitCard, type VisitCardData } from '@/components/VisitCard';
import { formatDateDMY } from '@/domain/fiscalYear';
import { upcastPayload } from '@/domain/coreAssessment';
import { REFERRING_SOURCE_LABELS, type ConsultationNote, type ConsultationNoteStatus, type Visit } from '@/domain/types';
import { toFriendlyMessage } from '@/lib/errors';
import { EditPatientModal } from './EditPatientModal';
import { EditVisitModal } from '@/features/visits/EditVisitModal';

const NOTE_STATUS_PILL: Record<ConsultationNoteStatus, { tone: 'green' | 'amber' | 'slate'; label: string }> = {
  draft: { tone: 'amber', label: 'Draft' },
  completed: { tone: 'green', label: 'Completed' },
  archived: { tone: 'slate', label: 'Archived' },
};

type VisitPaymentState = 'paid' | 'outstanding' | 'uninvoiced' | 'zero_session';

function visitPaymentState(
  billPaise: number,
  invoiceId: string | null,
  statusByInvoiceId: Map<string, string>
): VisitPaymentState {
  if (billPaise === 0) return 'zero_session';
  if (!invoiceId) return 'uninvoiced';
  return statusByInvoiceId.get(invoiceId) === 'outstanding' ? 'outstanding' : 'paid';
}


/**
 * Patient Hub — the patient-centric home of the app. One patient's identity,
 * care plan, latest clinical note, and a unified visit/documentation
 * activity feed, all on one page.
 */
export function PatientProfilePage() {
  const clinic = useClinic();
  const { patientId } = useParams({ strict: false }) as { patientId: string };
  const [editOpen, setEditOpen] = useState(false);
  const [selectedVisitIds, setSelectedVisitIds] = useState<Set<string>>(new Set());
  const [issuingInvoice, setIssuingInvoice] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);

  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);
  const notes = useLiveQuery(
    () => consultationNoteService.listByPatient(clinic.id, patientId),
    [clinic.id, patientId]
  );

  const visits = useLiveQuery(
    () => repos.visits.list({ clinicId: clinic.id, patientId }),
    [clinic.id, patientId]
  );
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const catalog = useLiveQuery(() => repos.catalog.list(clinic.id, true), [clinic.id]);
  const invoicePayments = useLiveQuery(() => repos.invoicePayments.list(clinic.id), [clinic.id]);
  const invoices = useLiveQuery(() => repos.invoices.list(clinic.id), [clinic.id]);

  const therapistName = useMemo(
    () => new Map((therapists ?? []).map((t) => [t.id, t.name])),
    [therapists]
  );
  const serviceName = useMemo(() => new Map((catalog ?? []).map((c) => [c.id, c.name])), [catalog]);
  const statusByInvoiceId = useMemo(
    () => new Map((invoicePayments ?? []).map((p) => [p.invoiceId, p.status])),
    [invoicePayments]
  );
  const visitRows = useMemo(
    () => [...(visits ?? [])].filter((v) => !v.deleted).sort((a, b) => b.visitDate.localeCompare(a.visitDate)),
    [visits]
  );

  const patientPackages = useMemo(
    () => (openPackages ?? []).filter((p) => p.patientId === patientId),
    [openPackages, patientId]
  );

  const outstandingBalance = useMemo(() => {
    if (!visits || !invoices) return 0;
    const invoiceStatusMap = new Map((invoicePayments ?? []).map((p) => [p.invoiceId, p.status]));
    let total = 0;
    for (const v of visits) {
      if (!v.deleted && v.invoiceId && invoiceStatusMap.get(v.invoiceId) === 'outstanding') {
        total += v.actualBillPaise;
      }
    }
    return total;
  }, [visits, invoices, invoicePayments]);

  const openPackageIds = useMemo(
    () => new Set((openPackages ?? []).map((p) => p.packageGroupId)),
    [openPackages]
  );

  const handleVisitDelete = useCallback(async (visitId: string) => {
    if (!confirm('Delete this visit?')) return;
    try {
      const visit = await repos.visits.get(visitId);
      if (visit && !visit.invoiceId) {
        await repos.visits.softDelete(visitId);
      }
    } catch (e) {
      console.error('Failed to delete visit:', e);
    }
  }, []);

  const toggleVisitSelection = useCallback((visitId: string) => {
    setSelectedVisitIds((prev) => {
      const next = new Set(prev);
      if (next.has(visitId)) {
        next.delete(visitId);
      } else {
        next.add(visitId);
      }
      return next;
    });
  }, []);

  const handleBulkIssueInvoice = useCallback(async () => {
    if (selectedVisitIds.size === 0) return;
    setIssuingInvoice(true);
    setIssueError(null);
    try {
      await invoiceService.issueForVisits(Array.from(selectedVisitIds), 'Cash');
      setSelectedVisitIds(new Set());
    } catch (e) {
      setIssueError(toFriendlyMessage(e));
    } finally {
      setIssuingInvoice(false);
    }
  }, [selectedVisitIds]);

  // Derived from the most recent Core Assessment note's safety-history
  // fields — no separate manual entry point, since a clinician already
  // captures these in the note. Empty when no note has been assessed yet.
  const safetyFlags = useMemo(() => {
    const latest = (notes ?? []).find((n) => n.assessmentPayload);
    if (!latest?.assessmentPayload) return [];
    const payload = upcastPayload(latest.assessmentPayload);
    const flags: string[] = [];
    if (payload.history.anticoagulant.onBloodThinner) {
      flags.push('On blood thinner — caution with dry needling and manual therapy (bleeding risk)');
    }
    if (payload.history.implants.present) {
      flags.push('Implants/pacemaker — avoid electrotherapy modalities (TENS, IFC, ultrasound over the site)');
    }
    if (payload.history.pregnancyStatus === 'yes') {
      flags.push('Pregnant — avoid contraindicated modalities and positions');
    }
    return flags;
  }, [notes]);

  if (!patient) {
    return (
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-8 text-sm text-[var(--muted)]">
        Patient not found (or not yet synced).
      </div>
    );
  }

  const initials = patient.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  const meta = [
    patient.age != null ? `${patient.age} yrs` : null,
    patient.sex,
    patient.phone,
  ].filter(Boolean);

  const referral = patient.referringSource
    ? [REFERRING_SOURCE_LABELS[patient.referringSource], patient.referringSourceDetail]
        .filter(Boolean)
        .join(' — ')
    : null;

  return (
    <div className="space-y-4">
      <Link to="/workspace" className="text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]">
        ← All patients
      </Link>

      {safetyFlags.length > 0 && (
        <div className="flex items-start gap-2 rounded-[10px] border border-[var(--rust)] bg-[var(--rust-light)] px-3.5 py-3 text-sm text-[var(--rust)]">
          <span className="shrink-0" aria-hidden>⚠</span>
          <div>
            <p className="font-semibold">Contraindications</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {safetyFlags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Patient identity header */}
      <section className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-xl bg-[var(--teal-light)] font-display text-lg font-semibold text-[var(--teal)]">
            {initials || '?'}
          </div>
          <div className="min-w-[12rem] flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-[var(--ink)]">{patient.name}</h1>
              <button
                onClick={() => setEditOpen(true)}
                className="text-[var(--muted)] hover:text-[var(--ink)]"
                title="Edit patient"
              >
                ✎
              </button>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
              <span>
                <span className="text-[var(--muted)]/70">MRN</span>{' '}
                <span className="font-num">{patient.mrno}</span>
              </span>
              {meta.length > 0 && <span className="font-num">{meta.join(' · ')}</span>}
              {referral && (
                <span>
                  <span className="text-[var(--muted)]/70">Ref</span> {referral}
                </span>
              )}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {outstandingBalance > 0 && (
                <span className="rounded-full bg-[var(--rust-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--rust)]">
                  ₹{(outstandingBalance / 100).toFixed(0)} outstanding
                </span>
              )}
              {patient.primaryCondition && (
                <span className="rounded-full bg-[var(--teal-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--teal)]">
                  {patient.primaryCondition}
                </span>
              )}
              {patient.mrnoSource === 'auto' && <Pill tone="slate">walk-in</Pill>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/visits/new" className={btnPrimary}>
              New visit
            </Link>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Main column */}
        <div className="space-y-4">
          <SectionLabel>Visit history</SectionLabel>
          {issueError && (
            <div className="rounded bg-[var(--rust-light)] p-2 text-sm text-[var(--rust)]">
              {issueError}
            </div>
          )}
          <section className="divide-y divide-[var(--border)] rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            {selectedVisitIds.size > 0 && (
              <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--teal-light)] px-4 py-2.5">
                <span className="text-sm font-medium text-[var(--teal)]">
                  {selectedVisitIds.size} selected
                </span>
                <button
                  type="button"
                  className="rounded-full bg-[var(--teal)] px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                  onClick={handleBulkIssueInvoice}
                  disabled={issuingInvoice}
                >
                  {issuingInvoice ? 'Issuing...' : 'Issue invoice for selected'}
                </button>
              </div>
            )}
            {visitRows.length === 0 ? (
              <p className="p-4 text-sm text-[var(--muted)]">No visits recorded yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {visitRows.map((v) => {
                  const isSelected = selectedVisitIds.has(v.id);
                  const canInvoice = !v.invoiceId;
                  const cardData: VisitCardData = {
                    visitId: v.id,
                    visitDate: v.visitDate,
                    patientId,
                    patientName: patient.name,
                    mrno: patient.mrno,
                    condition: v.condition ?? null,
                    serviceName: serviceName.get(v.serviceCatalogId) ?? '—',
                    sessionIndex: v.sessionIndex ?? null,
                    packageTotal: v.packageTotal ?? null,
                    therapistName: therapistName.get(v.therapistId) ?? '—',
                    treatmentNotes: v.treatmentNotes ?? null,
                    billPaise: v.actualBillPaise,
                    paymentState: visitPaymentState(v.actualBillPaise, v.invoiceId, statusByInvoiceId),
                    invoiceId: v.invoiceId ?? null,
                    canRepeat: openPackageIds.has(v.packageGroupId ?? ''),
                    canDelete: !v.invoiceId,
                  };
                  return (
                    <li key={v.id} className="flex items-start gap-3 px-3">
                      {canInvoice && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleVisitSelection(v.id)}
                          className="mt-4 shrink-0 cursor-pointer"
                          aria-label={`Select visit on ${formatDateDMY(v.visitDate)}`}
                        />
                      )}
                      <div className="flex-1">
                        <SharedVisitCard
                          data={cardData}
                          showDate={true}
                          showPatient={false}
                          onInvoice={() => {}}
                          onEdit={() => setEditingVisitId(v.id)}
                          onDelete={() => handleVisitDelete(v.id)}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Side column */}
        <div className="space-y-4">
          <ConsultationNotePanel patientId={patientId} notes={notes ?? []} />

          <SideCard title="Care plan">
            {patientPackages.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No open package.</p>
            ) : (
              <ul className="space-y-3">
                {patientPackages.map((p) => {
                  const pct = Math.min(100, Math.round((p.sessionsLogged / p.packageTotal) * 100));
                  return (
                    <li key={p.packageGroupId}>
                      <div className="flex items-center justify-between text-sm font-medium text-[var(--ink)]">
                        <span>{p.serviceName}</span>
                        {p.stale && <Pill tone="amber">⚠ Stale</Pill>}
                      </div>
                      <div className="my-1.5 h-2 overflow-hidden rounded-full bg-[var(--paper)]">
                        <span
                          className="block h-full rounded-full bg-[var(--teal)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="font-num flex justify-between text-xs text-[var(--muted)]">
                        <span>
                          {p.sessionsLogged} of {p.packageTotal} sessions
                        </span>
                        <span>last {formatDateDMY(p.lastVisitOn)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SideCard>

        </div>
      </div>

      {patient && (
        <EditPatientModal
          patient={patient}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSave={() => {
            setEditOpen(false);
          }}
        />
      )}

      {editingVisitId && (
        <EditVisitModal
          visitId={editingVisitId}
          onClose={() => setEditingVisitId(null)}
          onSave={(updated: Visit) => {
            void repos.visits.put(updated);
            setEditingVisitId(null);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Entry point into consultation notes. One open draft per patient at a
 * time (v1 constraint) — surface it instead of offering to start a second.
 */
function ConsultationNotePanel({
  patientId,
  notes,
}: {
  patientId: string;
  notes: ConsultationNote[];
}) {
  const draft = notes.find((n) => n.status === 'draft');
  const latest = notes[0]; // notes are pre-sorted most-recently-updated first
  const pill = latest ? NOTE_STATUS_PILL[latest.status] : null;

  return (
    <SideCard
      title="Consultation notes"
      action={
        <Link
          to={draft ? '/patients/$patientId/notes/$noteId' : '/patients/$patientId/notes/new'}
          params={draft ? { patientId, noteId: draft.id } : { patientId }}
          className={btnSecondary}
        >
          {draft ? 'Continue draft' : 'New note'}
        </Link>
      }
    >
      {!latest ? (
        <p className="text-sm text-[var(--muted)]">No notes yet.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {pill && <Pill tone={pill.tone}>{pill.label}</Pill>}
            <span className="font-num text-xs text-[var(--muted)]">
              updated {formatDateDMY(latest.updatedAt.slice(0, 10))}
            </span>
          </div>
          {notes.length > 1 && (
            <ul className="space-y-1 border-t border-[var(--border)] pt-2 text-xs">
              {notes.slice(1, 5).map((n) => (
                <li key={n.id} className="flex items-center justify-between">
                  <Link
                    to="/patients/$patientId/notes/$noteId"
                    params={{ patientId, noteId: n.id }}
                    className="text-[var(--muted)] hover:text-[var(--ink)]"
                  >
                    {formatDateDMY(n.updatedAt.slice(0, 10))}
                  </Link>
                  <Pill tone={NOTE_STATUS_PILL[n.status].tone}>{NOTE_STATUS_PILL[n.status].label}</Pill>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SideCard>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-0.5 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]/80">
      {children}
    </div>
  );
}

function SideCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-[var(--ink)]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
