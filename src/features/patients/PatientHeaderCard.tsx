import { Link } from '@tanstack/react-router';
import { useClinic } from '@/app/clinicContext';
import { PatientFollowUpLine } from '@/features/followUp/PatientFollowUpLine';
import { Pill, btnPrimary, btnSecondary } from '@/components/ui';
import { IconPhone, IconMessage } from '@/components/StatIcons';
import { openPatientWhatsAppChat } from '@/lib/pdfShare';
import { formatAmount } from '@/domain/money';
import { formatAppointmentWhen } from '@/domain/appointmentWhen';
import { placeLabelFor } from '@/domain/careLocations';
import { clinicTimezone } from '@/domain/clinicRegion';
import type { Appointment, Patient } from '@/domain/types';
import type { OpenPackageRow } from '@/services/dashboardService';
import { PatientAddressLine } from './PatientAddressLine';

/**
 * The patient profile's one header card: name with status pills (admitted, pain reported), the identity line, the
 * next appointment and open package, and the page's main actions (Call, WhatsApp, Edit, Book appointment, Record
 * advance, New visit). Everything it shows is worked out by the page; this only lays it out.
 */
export function PatientHeaderCard({
  patient,
  referral,
  outstandingPaise,
  advanceBalancePaise,
  nextAppointment,
  nextAppointmentTherapist,
  packages,
  admittedLabel,
  painReported,
  canRecordAdvance,
  onEdit,
  onBook,
  onRecordAdvance,
}: {
  patient: Patient;
  referral: string | null;
  outstandingPaise: number;
  advanceBalancePaise: number;
  nextAppointment: Appointment | undefined;
  nextAppointmentTherapist: string | undefined;
  /** This patient's open packages (the page's existing open-package rows). */
  packages: readonly OpenPackageRow[];
  /** "Admitted · Ortho, bed 2 · day 8" while a stay is open, else null. */
  admittedLabel: string | null;
  painReported: boolean;
  canRecordAdvance: boolean;
  onEdit: () => void;
  onBook: () => void;
  onRecordAdvance: () => void;
}) {
  const clinic = useClinic();
  const initials = patient.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  const ageSex = [patient.age != null ? `${patient.age} yrs` : null, patient.sex].filter(Boolean).join(' · ');
  const place = nextAppointment ? placeLabelFor(clinic, nextAppointment) : null;

  return (
    <section aria-label="Patient" className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-xl bg-[var(--teal-light)] font-display text-lg font-semibold text-[var(--teal)]">
          {initials || '?'}
        </div>
        <div className="min-w-[12rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl font-semibold text-[var(--ink)]">{patient.name}</h1>
            {admittedLabel && <Pill tone="teal">{admittedLabel}</Pill>}
            {painReported && <Pill tone="rust">Pain reported</Pill>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
            <span>
              <span className="text-[var(--muted)]/70">Patient ID</span> <span className="font-num">{patient.mrno}</span>
            </span>
            {ageSex && <span className="font-num">{ageSex}</span>}
            {patient.phone && <span className="font-num text-[var(--ink)]">{patient.phone}</span>}
            {patient.primaryCondition && <span className="text-[var(--teal)]">{patient.primaryCondition}</span>}
            {referral && <span>Ref: {referral}</span>}
            {patient.mrnoSource === 'auto' && <Pill tone="slate">walk-in</Pill>}
          </div>
          <PatientAddressLine clinic={clinic} address={patient.address} />
          <PatientFollowUpLine patient={patient} />
          {(nextAppointment || packages.length > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
              {nextAppointment && (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span>Next appointment</span>
                  <span className="font-num font-semibold text-[var(--ink)]">
                    {formatAppointmentWhen(nextAppointment.scheduledAt, clinicTimezone(clinic))}
                  </span>
                  {place && <Pill tone="slate">{place}</Pill>}
                  {nextAppointmentTherapist && <span>· {nextAppointmentTherapist}</span>}
                  <Link
                    to="/schedule"
                    search={{ date: nextAppointment.scheduledAt.slice(0, 10) }}
                    className="font-medium text-[var(--teal)] hover:underline"
                  >
                    View in schedule →
                  </Link>
                </span>
              )}
              {packages.map((p) => (
                <span key={p.packageGroupId} className="inline-flex items-center gap-1.5" title={p.serviceName}>
                  <span>Package</span>
                  <span className="font-num font-semibold text-[var(--ink)]">
                    {Math.max(0, p.packageTotal - p.sessionsLogged)} of {p.packageTotal} left
                  </span>
                </span>
              ))}
            </div>
          )}
          {(outstandingPaise > 0 || advanceBalancePaise > 0) && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {outstandingPaise > 0 && (
                <span className="rounded-full bg-[var(--rust-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--rust)]">
                  {formatAmount(outstandingPaise)} outstanding
                </span>
              )}
              {advanceBalancePaise > 0 && (
                <span className="rounded-full bg-[var(--teal-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--teal)]">
                  {formatAmount(advanceBalancePaise)} advance available
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {patient.phone && (
            <>
              <a href={`tel:${patient.phone}`} className={`${btnSecondary} inline-flex items-center gap-1.5`} title="Call patient">
                <IconPhone className="h-4 w-4 text-[var(--teal)]" />
                Call
              </a>
              <button
                type="button"
                className={`${btnSecondary} inline-flex items-center gap-1.5`}
                onClick={() => openPatientWhatsAppChat(`Hello ${patient.name}, this is ${clinic.name}.`, patient.phone)}
                title="Chat on WhatsApp"
              >
                <IconMessage className="h-4 w-4 text-[var(--teal)]" />
                WhatsApp
              </button>
            </>
          )}
          <button type="button" className={btnSecondary} onClick={onEdit} title="Edit patient">
            Edit
          </button>
          <button type="button" className={btnSecondary} onClick={onBook}>
            Book appointment
          </button>
          {canRecordAdvance && (
            <button type="button" className={btnSecondary} onClick={onRecordAdvance}>
              Record advance
            </button>
          )}
          <Link to="/visits/new" search={{ patientId: patient.id }} className={`${btnPrimary} inline-flex items-center justify-center`}>
            New visit
          </Link>
        </div>
      </div>
    </section>
  );
}
