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
import { filterChip, LoadingRows, Pill, SectionCard, pillAccent, pillNeutral } from '@/components/ui';
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

  const displayedGroups = useMemo(() => {
    if (selectedWard === 'all') return groups;
    return groups.filter((g) => g.key === selectedWard);
  }, [groups, selectedWard]);

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
                  className={filterChip(selectedWard === 'all')}
                >
                  All <span className="ml-1 text-xs opacity-80">({rowsInScope.length})</span>
                </button>
                {groups.map((g) => {
                  const active = selectedWard === g.key;
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

            {displayedGroups.map((g) => (
              <section key={g.key || 'none'} aria-label={g.label}>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {g.label}
                </h3>
                <ul className="-mx-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                  {g.rows.map((row) => (
                    <li
                      key={row.stay.id}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3"
                    >
                      <div className="min-w-[12rem] flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to="/patients/$patientId"
                            params={{ patientId: row.patient.id }}
                            className="font-medium text-[var(--ink)] hover:text-[var(--teal)] hover:underline"
                          >
                            {row.patient.name}
                          </Link>
                          {row.bed && <Pill tone="slate">{row.bed}</Pill>}
                          <Pill tone="slate">Day {row.day}</Pill>
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
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {[
                            row.stay.ipdNo && `IPD ${row.stay.ipdNo}`,
                            row.stay.admittingDoctor &&
                            `Dr. ${row.stay.admittingDoctor.replace(/^Dr\.?\s*/i, '')}`,
                            row.patient.primaryCondition || row.lastSession?.condition,
                            row.unbilledSessions.length > 0 &&
                            `${row.unbilledSessions.length} session${row.unbilledSessions.length === 1 ? '' : 's'} · ${formatAmount(row.unbilledPaise)}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={pillNeutral}
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
                              className={pillNeutral}
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
                          className={row.seenToday > 0 ? pillNeutral : pillAccent}
                        >
                          {row.seenToday > 0 ? '+ Log another' : '+ Log session'}
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
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
