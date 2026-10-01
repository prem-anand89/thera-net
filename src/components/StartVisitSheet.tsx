import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ErrorNote, Field, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { usePermissions } from '@/app/usePermissions';
import { toFriendlyMessage } from '@/lib/errors';
import { bookingService, patientService, repos } from '@/services';
import type { Appointment, Patient, UUID } from '@/domain/types';

/**
 * Start seeing a patient before deciding the service:
 *  - "Start note" opens the Core Assessment with no visit yet. A walk-in gets
 *    an arrived appointment (`start_walk_in`) so it shows as "in progress" and
 *    the visit — service, treatment, payment — can be completed later; the
 *    note joins that visit automatically when it's logged.
 *  - "Log visit now" is the usual New Visit form.
 * Opened from an appointment ("Start note") or New Visit ("Start a note first").
 */
export function StartVisitSheet({
  open,
  onClose,
  appointment,
  initialPatientId,
}: {
  open: boolean;
  onClose: () => void;
  /** Starting from a booked appointment instead of a walk-in. */
  appointment?: Appointment | null;
  /** Pre-select an existing patient (e.g. from New Visit). */
  initialPatientId?: UUID;
}) {
  const clinic = useClinic();
  const navigate = useNavigate();
  const scope = useWorkspaceScope();
  const { canViewClinicalNotes } = usePermissions();
  const canWriteNotes = Boolean(clinic.clinicalDocsEnabled) && canViewClinicalNotes;
  const canManageAll = scope.isClinicWideView;

  const patients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const [mode, setMode] = useState<'find' | 'new'>('find');
  const [patientId, setPatientId] = useState<UUID | ''>('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [therapistId, setTherapistId] = useState<UUID | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A "New patient" created on a try whose next step failed (e.g. offline
  // for start_walk_in) — reused on retry instead of creating a duplicate.
  const createdPatient = useRef<Patient | null>(null);

  useEffect(() => {
    if (!open) return;
    createdPatient.current = null;
    setError(null);
    setBusy(false);
    setPatientId(appointment?.patientId ?? initialPatientId ?? '');
    setMode(appointment && !appointment.patientId ? 'new' : 'find');
    setName(appointment?.patientName ?? '');
    setPhone(appointment?.patientPhone ?? '');
    setTherapistId(appointment?.therapistId ?? scope.myTherapistId ?? '');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when opened
  }, [open, appointment?.id]);

  // A single-therapist clinic, or a therapist login, shouldn't have to choose.
  useEffect(() => {
    if (!open || therapistId || !therapists) return;
    if (therapists.length === 1) setTherapistId(therapists[0].id);
  }, [open, therapistId, therapists]);

  const options = useMemo(
    () =>
      [...(patients ?? [])]
        .filter((p) => !p.deletedAt)
        .sort((a: Patient, b: Patient) => a.name.localeCompare(b.name))
        .map((p: Patient) => ({ value: p.id, label: `${p.name} (${p.phone ?? p.mrno})` })),
    [patients]
  );

  if (!open) return null;
  const therapistLocked = !canManageAll;

  /** The chosen patient, creating them first when "New patient" is picked. */
  async function resolvePatient(): Promise<Patient> {
    if (mode === 'find') {
      const found = patients?.find((p) => p.id === patientId);
      if (!found) throw new Error('Choose a patient, or switch to New patient.');
      return found;
    }
    if (!name.trim()) throw new Error('Enter the patient name.');
    const earlier = createdPatient.current;
    if (earlier && earlier.name.trim() === name.trim() && (earlier.phone ?? '').trim() === phone.trim()) return earlier;
    const created = await patientService.create({ clinicId: clinic.id, name, phone: phone || null });
    createdPatient.current = created;
    return created;
  }

  async function startNote() {
    if (!therapistId) return setError('Choose a therapist.');
    setBusy(true);
    setError(null);
    try {
      const patient = await resolvePatient();
      let appointmentId = appointment?.id;
      if (appointment) {
        if (appointment.status === 'confirmed' || appointment.status === 'rescheduled') {
          await bookingService.markAppointmentArrived(appointment.id);
        }
      } else {
        appointmentId = await bookingService.startWalkIn({
          clinicId: clinic.id,
          therapistId,
          patientName: patient.name,
          patientPhone: patient.phone,
          patientId: patient.id,
        });
      }
      onClose();
      void navigate({
        to: '/patients/$patientId/notes/new',
        params: { patientId: patient.id },
        search: { appointmentId, from: '/workspace' },
      });
    } catch (startError) {
      setError(toFriendlyMessage(startError));
    } finally {
      setBusy(false);
    }
  }

  async function logVisit() {
    setBusy(true);
    setError(null);
    try {
      const patient = await resolvePatient();
      onClose();
      void navigate({
        to: '/visits/new',
        search: {
          patientId: patient.id,
          ...(appointment ? { appointmentId: appointment.id } : {}),
          prefillName: patient.name,
          ...(patient.phone ? { prefillPhone: patient.phone } : {}),
        },
      });
    } catch (startError) {
      setError(toFriendlyMessage(startError));
    } finally {
      setBusy(false);
    }
  }

  const therapistName = (therapists ?? []).find((t) => t.id === therapistId)?.name;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/45 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-visit-title"
        className="w-full rounded-t-2xl bg-[var(--surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:max-w-md sm:rounded-2xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="start-visit-title" className="font-display text-lg font-semibold text-[var(--ink)]">
              {appointment ? `Start with ${appointment.patientName}` : 'Start a visit'}
            </h2>
            <p className="text-sm text-[var(--muted)]">
              Write notes now and add the service and payment later — or log the visit straight away.
            </p>
          </div>
          <button type="button" className="min-h-11 px-2 text-sm text-[var(--muted)]" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="space-y-4">
          {!(appointment?.patientId) && (
            <div>
              <div className="mb-3 flex gap-2">
                <button type="button" className={mode === 'find' ? btnPrimary : btnSecondary} onClick={() => setMode('find')}>
                  Find patient
                </button>
                <button type="button" className={mode === 'new' ? btnPrimary : btnSecondary} onClick={() => setMode('new')}>
                  New patient
                </button>
              </div>
              {mode === 'find' ? (
                <SearchableSelect label="" value={patientId} onChange={(value) => setPatientId(value as UUID)} options={options} placeholder="Search name, phone or ID" />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Patient name *">
                    <input className={inputCls} value={name} onChange={(event) => setName(event.target.value)} autoFocus />
                  </Field>
                  <Field label="Phone">
                    <input type="tel" className={inputCls} value={phone} onChange={(event) => setPhone(event.target.value)} />
                  </Field>
                  <p className="text-xs text-[var(--muted)] sm:col-span-2">Add age, email and other details later from their profile.</p>
                </div>
              )}
            </div>
          )}

          {therapistLocked ? (
            therapistName && <p className="text-sm text-[var(--muted)]">Therapist: <span className="text-[var(--ink)]">{therapistName}</span></p>
          ) : (
            <Field label="Therapist">
              <select className={inputCls} value={therapistId} onChange={(event) => setTherapistId(event.target.value as UUID)}>
                <option value="">Choose therapist</option>
                {(therapists ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <ErrorNote message={error} />

          <div className="grid gap-2 sm:grid-cols-2">
            {canWriteNotes && (
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void startNote()}>
                {busy ? 'Starting…' : 'Start note'}
              </button>
            )}
            <button type="button" className={canWriteNotes ? btnSecondary : btnPrimary} disabled={busy} onClick={() => void logVisit()}>
              Log visit now
            </button>
          </div>
          {canWriteNotes && (
            <p className="text-xs text-[var(--muted)]">
              "Start note" marks them as arrived and keeps the visit open under Today → Appointments until you add the service and payment.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
