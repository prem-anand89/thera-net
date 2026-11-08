import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { useEntitlements } from '@/app/useEntitlements';
import { repos } from '@/services';
import type { Admission, Patient } from '@/domain/types';
import { clinicCareLocations } from '@/domain/careLocations';
import { dayOfStay, wardOf } from '@/domain/admissions';
import { toLocalDateStr } from '@/domain/schedule';
import { LoadingRows, Pill, SectionCard, pillAccent, pillNeutral } from '@/components/ui';
import { AddPatientSheet } from '@/features/patients/AddPatientSheet';
import { AdmissionSheet } from '@/features/patients/AdmissionSheet';
import { AdmitPatientPicker } from './AdmitPatientPicker';

/**
 * Workspace → Inpatients: who is on the ward, grouped by ward, with day of stay and whether they were seen today. "Log
 * session" opens New Visit for that stay (an Inpatient round, saved unpaid, filled from the last session on the stay).
 * Shown only for a clinic with Inpatient on. Everyone on the ward is listed: it is not narrowed by All | Mine or Place.
 */
export function InpatientsCard() {
  const clinic = useClinic();
  const entitlements = useEntitlements(clinic.id);
  const wardOn = clinicCareLocations(clinic).includes('ward');
  const today = toLocalDateStr(new Date());

  const data = useLiveQuery(async () => {
    if (!wardOn) return null;
    const [stays, patients, visits] = await Promise.all([
      repos.admissions.listOpen(clinic.id),
      repos.patients.list(clinic.id),
      repos.visits.list({ clinicId: clinic.id }),
    ]);
    return { stays, patients, visits };
  }, [clinic.id, wardOn]);

  const [picking, setPicking] = useState(false);
  const [addingPatient, setAddingPatient] = useState(false);
  const [admitting, setAdmitting] = useState<Patient | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const byPatient = new Map(data.patients.map((p) => [p.id, p]));
    return data.stays
      .map((stay) => {
        const sessions = data.visits.filter((v) => !v.deleted && v.admissionId === stay.id);
        const last = [...sessions].sort((a, b) => b.visitDate.localeCompare(a.visitDate))[0];
        return {
          stay,
          patient: byPatient.get(stay.patientId),
          seenToday: sessions.filter((v) => v.visitDate === today).length,
          lastVisitId: last?.id,
        };
      })
      .filter((r): r is typeof r & { patient: Patient } => Boolean(r.patient));
  }, [data, today]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: typeof rows }>();
    for (const r of rows) {
      const w = wardOf(r.stay.wardBed);
      const g = map.get(w.key) ?? { label: w.label, rows: [] };
      g.rows.push(r);
      map.set(w.key, g);
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([key, g]) => ({
        key,
        label: g.label,
        rows: g.rows.sort((x, y) => (x.stay.wardBed ?? '').localeCompare(y.stay.wardBed ?? '', undefined, { numeric: true })),
      }));
  }, [rows]);

  const canAdmit = entitlements.can('inpatient');
  // A clinic with Inpatient on but on a plan without it, and nobody admitted, has nothing to show.
  if (!wardOn || (data && data.stays.length === 0 && !canAdmit)) return null;
  const admittedIds = new Set((data?.stays ?? []).map((s: Admission) => s.patientId));

  return (
    <>
      <SectionCard
        title="Inpatients"
        badge={data ? <Pill tone="slate">{rows.length}</Pill> : undefined}
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
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nobody is admitted. Use “+ Admit patient” to add someone to the ward.</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <section key={g.key || 'none'} aria-label={g.label}>
                <h3 className="mb-1.5 text-xs font-medium text-[var(--muted)]">{g.label}</h3>
                <ul className="-mx-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                  {g.rows.map(({ stay, patient, seenToday, lastVisitId }) => (
                    <li key={stay.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                      <div className="min-w-[12rem] flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to="/patients/$patientId"
                            params={{ patientId: patient.id }}
                            className="font-medium text-[var(--ink)] hover:text-[var(--teal)] hover:underline"
                          >
                            {patient.name}
                          </Link>
                          {seenToday > 0 && (
                            <Pill tone="green">Seen today{seenToday > 1 ? ` (${seenToday} sessions)` : ''}</Pill>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          {[stay.wardBed, stay.ipdNo && `IPD ${stay.ipdNo}`, `Day ${dayOfStay(stay.admittedOn, today)}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <Link
                        to="/visits/new"
                        search={{
                          patientId: patient.id,
                          admissionId: stay.id,
                          from: '/workspace',
                          ...(lastVisitId ? { repeatVisitId: lastVisitId } : {}),
                        }}
                        className={seenToday > 0 ? pillNeutral : pillAccent}
                      >
                        {seenToday > 0 ? '+ Log another session' : '+ Log session'}
                      </Link>
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
    </>
  );
}
