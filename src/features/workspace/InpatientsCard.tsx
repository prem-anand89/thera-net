import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { useEntitlements } from '@/app/useEntitlements';
import { repos } from '@/services';
import type { Admission, Patient, Visit } from '@/domain/types';
import { clinicCareLocations } from '@/domain/careLocations';
import { dayOfStay, splitWardBed, wardOf } from '@/domain/admissions';
import { canBillInpatientStay } from '@/domain/departmentMoney';
import { toLocalDateStr } from '@/domain/schedule';
import { formatAmount } from '@/domain/money';
import { formatDateDM } from '@/domain/fiscalYear';
import { filterChip, LoadingRows, Pill, SectionCard, pillAccent, pillSmAccent, pillSmNeutral } from '@/components/ui';
import { IssueInvoiceDialog, type IssueInvoiceTarget } from '@/components/IssueInvoiceDialog';
import { AddPatientSheet } from '@/features/patients/AddPatientSheet';
import { AdmissionSheet } from '@/features/patients/AdmissionSheet';
import { AdmitPatientPicker } from './AdmitPatientPicker';

function formatTimeHHMM(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export interface InpatientsCardProps {
  viewTherapistId?: string;
}

/**
 * Workspace → Inpatients: who is on the ward, grouped by ward, with day of stay, bed pill,
 * timing badges (Seen today / Next round HH:MM / Pending round), and 1-tap inline actions
 * (Edit stay, Bill stay, Log session).
 */
export function InpatientsCard({ viewTherapistId }: InpatientsCardProps = {}) {
  const clinic = useClinic();
  const { canBill } = usePermissions();
  const entitlements = useEntitlements(clinic.id);
  const wardOn = clinicCareLocations(clinic).includes('ward');
  const today = toLocalDateStr(new Date());

  const data = useLiveQuery(async () => {
    if (!wardOn) return null;
    const [stays, patients, therapists, appointments] = await Promise.all([
      repos.admissions.listOpen(clinic.id),
      repos.patients.list(clinic.id),
      repos.therapists.list(clinic.id, true),
      repos.appointments.listByClinic(clinic.id),
    ]);
    const patientIds = [...new Set(stays.map((s) => s.patientId))];
    const visits = (
      await Promise.all(
        patientIds.map((patientId) => repos.visits.list({ clinicId: clinic.id, patientId }))
      )
    ).flat();
    return { stays, patients, therapists, appointments, visits };
  }, [clinic.id, wardOn]);

  const [picking, setPicking] = useState(false);
  const [addingPatient, setAddingPatient] = useState(false);
  const [admitting, setAdmitting] = useState<Patient | null>(null);
  const [editingStay, setEditingStay] = useState<{ stay: Admission; patient: Patient } | null>(null);
  const [invoicingStay, setInvoicingStay] = useState<IssueInvoiceTarget | null>(null);
  const [selectedWard, setSelectedWard] = useState<string>('all');

  const rows = useMemo(() => {
    if (!data) return [];
    const byPatient = new Map(data.patients.map((p) => [p.id, p]));
    const therapistNameById = new Map(data.therapists.map((t) => [t.id, t.name]));

    const todayWardAppointments = (data.appointments ?? []).filter((apt) => {
      if (apt.location !== 'ward' || apt.status === 'cancelled') return false;
      const aptDate = toLocalDateStr(new Date(apt.scheduledAt));
      return aptDate === today;
    });

    return data.stays
      .map((stay) => {
        const patient = byPatient.get(stay.patientId);
        if (!patient) return null;

        const sessions = data.visits.filter((v) => !v.deleted && v.admissionId === stay.id);
        const lastSession = [...sessions].sort((a, b) => b.visitDate.localeCompare(a.visitDate))[0];
        const todaySessions = sessions.filter((v) => v.visitDate === today);
        const seenToday = todaySessions.length;

        const seenByNames = [
          ...new Set(
            todaySessions
              .map((v) => therapistNameById.get(v.therapistId)?.split(' ')[0])
              .filter((n): n is string => Boolean(n))
          ),
        ];

        const unbilledSessions = sessions.filter((v) => !v.invoiceId);
        const unbilledPaise = unbilledSessions.reduce(
          (sum: number, v: Visit) => sum + (v.actualBillPaise ?? 0),
          0
        );

        const patientApts = todayWardAppointments
          .filter((apt) => apt.patientId === stay.patientId || (apt.admissionId && apt.admissionId === stay.id))
          .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
        const nextRoundTime = patientApts[0] ? formatTimeHHMM(patientApts[0].scheduledAt) : null;

        const ward = wardOf(stay.wardBed);
        const { bed } = splitWardBed(stay.wardBed);
        const day = dayOfStay(stay.admittedOn, today);

        const matchesMine =
          !viewTherapistId ||
          sessions.some((v) => v.therapistId === viewTherapistId) ||
          patientApts.some((a) => a.therapistId === viewTherapistId) ||
          sessions.length === 0;

        return {
          stay,
          patient,
          ward,
          bed,
          day,
          sessions,
          totalSessions: sessions.length,
          lastSession,
          lastVisitId: lastSession?.id,
          todaySessions,
          seenToday,
          seenByNames,
          unbilledSessions,
          unbilledPaise,
          nextRoundTime,
          matchesMine,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [data, today, viewTherapistId]);

  const rowsInScope = useMemo(() => {
    return viewTherapistId ? rows.filter((r) => r.matchesMine) : rows;
  }, [rows, viewTherapistId]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: typeof rowsInScope }>();
    for (const r of rowsInScope) {
      const g = map.get(r.ward.key) ?? { label: r.ward.label, rows: [] };
      g.rows.push(r);
      map.set(r.ward.key, g);
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([key, g]) => ({
        key,
        label: g.label,
        rows: g.rows.sort((x, y) =>
          (x.bed || '').localeCompare(y.bed || '', undefined, { numeric: true })
        ),
      }));
  }, [rowsInScope]);

  // A chosen ward that has since emptied (last patient discharged) falls back to All, so the card is never blank.
  const activeWard = selectedWard !== 'all' && groups.some((g) => g.key === selectedWard) ? selectedWard : 'all';
  const displayedGroups = useMemo(() => {
    if (activeWard === 'all') return groups;
    return groups.filter((g) => g.key === activeWard);
  }, [groups, activeWard]);

  const canAdmit = entitlements.can('inpatient');
  if (!wardOn || (data && data.stays.length === 0 && !canAdmit)) return null;
  const admittedIds = new Set((data?.stays ?? []).map((s: Admission) => s.patientId));

  return (
    <>
      <SectionCard
        title="Inpatients"
        badge={data ? <Pill tone="slate">{rowsInScope.length}</Pill> : undefined}
        action={
          canAdmit ? (
            <button type="button" className={`shrink-0 ${pillAccent}`} onClick={() => setPicking(true)}>
              + Admit patient
            </button>
          ) : undefined
        }
      >
        {data === undefined || data === null ? (
          <LoadingRows rows={2} label="Loading inpatients" />
        ) : rowsInScope.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            {rows.length > 0
              ? 'No inpatients matched your therapist filter.'
              : 'Nobody is admitted. Use “+ Admit patient” to add someone to the ward.'}
          </p>
        ) : (
          <div className="space-y-4">
            {groups.length > 1 && (
              <div
                role="group"
                aria-label="Filter by ward"
                className="hide-scrollbar flex items-center gap-1.5 overflow-x-auto pb-1"
              >
                <button
                  type="button"
                  onClick={() => setSelectedWard('all')}
                  className={filterChip(activeWard === 'all')}
                >
                  All <span className="ml-1 text-xs opacity-80">({rowsInScope.length})</span>
                </button>
                {groups.map((g) => {
                  const active = activeWard === g.key;
                  return (
                    <button
                      key={g.key || 'none'}
                      type="button"
                      onClick={() => setSelectedWard(g.key)}
                      className={filterChip(active)}
                    >
                      {g.label} <span className="ml-1 text-xs opacity-80">({g.rows.length})</span>
                    </button>
                  );
                })}
              </div>
            )}

            {displayedGroups.map((g) => {
              const inpatientGridCols =
                'tab:grid tab:grid-cols-[9.5rem_minmax(0,1fr)_7.5rem_6rem_10.5rem] desktop:grid-cols-[10.5rem_minmax(0,1fr)_8rem_6.5rem_15rem] tab:items-center tab:gap-2.5 desktop:gap-4';
              return (
                <section key={g.key || 'none'} aria-label={g.label}>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                    {g.label}
                  </h3>
                  <div className="-mx-5 overflow-x-auto overflow-y-visible">
                    <div className="min-w-full">
                      <div className={`hidden ${inpatientGridCols} px-4 tab:px-5 py-2.5 border-y border-[var(--border)] bg-[var(--paper)] text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]`}>
                        <div>Patient & Bed</div>
                        <div>Doctor & Condition</div>
                        <div>Rounds Today</div>
                        <div className="text-right">Unbilled</div>
                        <div className="text-right">Actions</div>
                      </div>
                      <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)] tab:border-t-0">
                        {g.rows.map((row, i) => (
                          <li
                            key={row.stay.id}
                            className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 py-2.5 px-4 tab:px-5 ${inpatientGridCols} hover:bg-[var(--teal-light)] transition-colors ${
                              i % 2 === 1 ? 'tab:bg-[var(--paper)]' : 'tab:bg-[var(--surface)]'
                            }`}
                          >
                            {/* Col 1: Patient & Bed */}
                            <div className="min-w-0 tab:col-auto">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Link
                                  to="/patients/$patientId"
                                  params={{ patientId: row.patient.id }}
                                  className="font-display text-sm font-medium text-[var(--ink)] hover:text-[var(--teal)] hover:underline truncate"
                                >
                                  {row.patient.name}
                                </Link>
                                {row.bed && <Pill tone="slate">{row.bed}</Pill>}
                                <Pill tone="slate">Day {row.day}</Pill>
                              </div>
                              <div className="hidden tab:flex items-center gap-1.5 font-num text-xs text-[var(--muted)] mt-0.5 truncate">
                                {row.stay.ipdNo && <span>IPD {row.stay.ipdNo}</span>}
                                {row.stay.ipdNo && row.stay.admittedOn && <span>·</span>}
                                {row.stay.admittedOn && <span>Adm {formatDateDM(row.stay.admittedOn)}</span>}
                              </div>
                            </div>

                            {/* Col 2: Doctor & Condition */}
                            <div className="col-span-2 text-xs tab:col-auto tab:text-sm text-[var(--muted)] min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 tab:block">
                                {row.stay.admittingDoctor ? (
                                  <span className="font-medium text-[var(--ink)] truncate tab:block">
                                    Dr. {row.stay.admittingDoctor.replace(/^Dr\.?\s*/i, '')}
                                  </span>
                                ) : (
                                  <span className="text-[var(--muted)] font-normal hidden tab:block">—</span>
                                )}
                                {(row.patient.primaryCondition || row.lastSession?.condition) && (
                                  <>
                                    <span className="tab:hidden text-[var(--border)]">·</span>
                                    <span className="truncate tab:block tab:text-xs text-[var(--muted)]">
                                      {row.patient.primaryCondition || row.lastSession?.condition}
                                    </span>
                                  </>
                                )}
                                {row.stay.ipdNo && (
                                  <span className="tab:hidden text-[var(--muted)]">
                                    · IPD {row.stay.ipdNo}
                                  </span>
                                )}
                                {row.stay.admittedOn && (
                                  <span className="tab:hidden text-[var(--muted)] font-num">
                                    · Adm {formatDateDM(row.stay.admittedOn)}
                                  </span>
                                )}
                                {row.unbilledSessions.length > 0 && (
                                  <span className="tab:hidden font-num font-medium text-[var(--ink)]">
                                    · {row.unbilledSessions.length} sess · {formatAmount(row.unbilledPaise)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Col 3: Rounds Today */}
                            <div className="col-start-2 row-start-1 justify-self-end shrink-0 tab:col-auto tab:row-auto tab:justify-self-start tab:min-w-0">
                              {row.seenToday > 0 ? (
                                <Pill tone="green">
                                  Seen today
                                  {row.seenByNames.length > 0 ? ` · ${row.seenByNames.join(', ')}` : ''}
                                  {row.seenToday > 1 ? ` (${row.seenToday})` : ''}
                                </Pill>
                              ) : row.nextRoundTime ? (
                                <Pill tone="teal">Next round {row.nextRoundTime}</Pill>
                              ) : (
                                <Pill tone="amber">Pending round</Pill>
                              )}
                            </div>

                            {/* Col 4: Unbilled */}
                            <div className="hidden tab:block text-right tab:col-auto">
                              {row.unbilledSessions.length > 0 ? (
                                <div>
                                  <div className="font-num text-sm font-medium text-[var(--ink)]">
                                    {formatAmount(row.unbilledPaise)}
                                  </div>
                                  <div className="text-xs text-[var(--muted)]">
                                    {row.unbilledSessions.length} sess unbilled
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <span className="text-sm text-[var(--muted)]">—</span>
                                  {row.totalSessions > 0 && (
                                    <div className="text-xs text-[var(--muted)] font-num">
                                      {row.totalSessions} sess total
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Col 5: Actions */}
                            <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-end gap-1.5 pt-1 border-t border-[var(--border)]/50 tab:col-auto tab:pt-0 tab:border-t-0">
                              <button
                                type="button"
                                className={pillSmNeutral}
                                onClick={() => setEditingStay({ stay: row.stay, patient: row.patient })}
                              >
                                Edit stay
                              </button>
                              {canBill &&
                                canBillInpatientStay(clinic) &&
                                row.unbilledSessions.length > 0 &&
                                row.unbilledPaise > 0 && (
                                  <button
                                    type="button"
                                    className={pillSmNeutral}
                                    onClick={() =>
                                      setInvoicingStay({
                                        visitId: row.unbilledSessions[0].id,
                                        visitIds: row.unbilledSessions.map((v) => v.id),
                                        patientId: row.patient.id,
                                        patientLabel: row.patient.name,
                                        serviceLabel: `Inpatient stay, ${row.unbilledSessions.length} session${row.unbilledSessions.length === 1 ? '' : 's'}`,
                                        isPackage: false,
                                        alreadyCollected: false,
                                      })
                                    }
                                  >
                                    Bill stay
                                  </button>
                                )}
                              <Link
                                to="/visits/new"
                                search={{
                                  patientId: row.patient.id,
                                  admissionId: row.stay.id,
                                  from: '/workspace',
                                  ...(row.lastVisitId ? { repeatVisitId: row.lastVisitId } : {}),
                                }}
                                className={row.seenToday > 0 ? pillSmNeutral : pillSmAccent}
                              >
                                {row.seenToday > 0 ? '+ Log another' : '+ Log session'}
                              </Link>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </SectionCard>

      <AdmitPatientPicker
        open={picking}
        onClose={() => setPicking(false)}
        admittedIds={admittedIds}
        onPick={(p) => {
          setPicking(false);
          setAdmitting(p);
        }}
        onAddNew={() => {
          setPicking(false);
          setAddingPatient(true);
        }}
      />
      <AddPatientSheet
        open={addingPatient}
        onClose={() => setAddingPatient(false)}
        onCreated={(p) => {
          setAddingPatient(false);
          setAdmitting(p);
        }}
        onUseExisting={(p) => {
          setAddingPatient(false);
          setAdmitting(p);
        }}
      />
      {admitting && <AdmissionSheet open onClose={() => setAdmitting(null)} patient={admitting} />}
      {editingStay && (
        <AdmissionSheet
          open
          onClose={() => setEditingStay(null)}
          patient={editingStay.patient}
          stay={editingStay.stay}
        />
      )}
      {invoicingStay && (
        <IssueInvoiceDialog
          clinicId={clinic.id}
          target={invoicingStay}
          onClose={() => setInvoicingStay(null)}
          returnTo="/workspace"
        />
      )}
    </>
  );
}
