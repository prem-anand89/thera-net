import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, patientActivityService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { PatientOverview } from '@/features/visits/PatientOverview';
import { SectionCard, Pill, btnSecondary } from '@/components/ui';
import type { ActivityKind } from '@/services/patientActivityService';
import { canUseModule } from '@/domain/modules';

const KIND_LABELS: Record<ActivityKind, string> = {
  visit: 'Visit',
  consultation_note: 'Note',
  module_enrollment: 'Enrollment',
  screening_response: 'Gut Screening',
  return_to_sport_response: 'Return to Sport',
  scoliosis_screening_response: 'Scoliosis Screening',
  face_scale_response: 'FaCE Scale',
  facial_palsy_assessment: 'Facial Palsy',
};

const KIND_TONES: Record<ActivityKind, 'green' | 'amber' | 'slate'> = {
  visit: 'green',
  consultation_note: 'slate',
  module_enrollment: 'amber',
  screening_response: 'amber',
  return_to_sport_response: 'amber',
  scoliosis_screening_response: 'amber',
  face_scale_response: 'amber',
  facial_palsy_assessment: 'amber',
};

/**
 * Patient Hub centerpiece: one patient's demographics plus a unified,
 * cross-module activity feed (visits, clinical notes, module enrollments,
 * screening results). This is the integration surface every attached module
 * writes into via its own table — the page itself has no module-specific
 * logic beyond labeling.
 */
export function PatientProfilePage() {
  const clinic = useClinic();
  const { patientId } = useParams({ strict: false }) as { patientId: string };
  const [daysBack, setDaysBack] = useState<number | undefined>(undefined);

  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);
  const activity = useLiveQuery(
    () => patientActivityService.getActivityForPatient(clinic.id, patientId, daysBack),
    [clinic.id, patientId, daysBack]
  );
  const enrollments = useLiveQuery(
    () => patientActivityService.getEnrollments(clinic.id, patientId),
    [clinic.id, patientId]
  );
  const faceScaleHistory = useLiveQuery(
    () => repos.faceScale.list(clinic.id, patientId),
    [clinic.id, patientId]
  );
  const facialPalsyHistory = useLiveQuery(
    () => repos.facialPalsy.list(clinic.id, patientId),
    [clinic.id, patientId]
  );

  // Tier 1 (clinic enabled?) + Tier 2 (my role permitted?) — mirrors the
  // can_use_module() SQL function that ultimately gates the write via RLS.
  // Both queries read local Dexie data, so the launcher works offline.
  const moduleSettings = useLiveQuery(() => repos.moduleSettings.list(clinic.id), [clinic.id]);
  const myRole = useLiveQuery(() => repos.myMembership.getRole(clinic.id), [clinic.id]);
  const canFaceScale = canUseModule(moduleSettings, 'face_scale', myRole ?? null);
  const canFacialPalsy = canUseModule(moduleSettings, 'facial_palsy', myRole ?? null);

  if (!patient) {
    return <div className="p-8 text-sm text-[var(--muted)]">Patient not found (or not yet synced).</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/patients" className={btnSecondary}>
          ← Back
        </Link>
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">{patient.name}</h1>
      </div>

      <PatientOverview patient={patient} />

      {enrollments && enrollments.length > 0 && (
        <SectionCard title="Module enrollments">
          <div className="flex flex-wrap gap-2">
            {enrollments.map((e) => (
              <Pill key={e.id} tone={e.status === 'active' ? 'green' : 'slate'}>
                {KIND_LABELS.module_enrollment}: {e.moduleType.replace(/_/g, ' ')} ({e.status})
              </Pill>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Assessments">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {canFaceScale && (
            <Link
              to="/patients/$patientId/face-scale/new"
              params={{ patientId }}
              className={btnSecondary}
            >
              + FaCE Scale
            </Link>
          )}
          {canFacialPalsy && (
            <Link
              to="/patients/$patientId/facial-palsy/new"
              params={{ patientId }}
              className={btnSecondary}
            >
              + Facial Palsy (HB/Sunnybrook)
            </Link>
          )}
          {moduleSettings && myRole !== undefined && !canFaceScale && !canFacialPalsy && (
            <p className="text-xs text-[var(--muted)]">
              No assessment modules are available to you here — ask your clinic admin to enable one in Setup, or check your role.
            </p>
          )}
        </div>

        {/* Longitudinal trend: turns a one-shot calculator into an outcome
            tracker — the source HTML tools discard every result on reset. */}
        {faceScaleHistory && faceScaleHistory.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-xs font-semibold text-[var(--muted)]">FaCE Scale — total score over time</div>
            <table className="w-full text-sm">
              <tbody>
                {[...faceScaleHistory]
                  .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
                  .map((f) => (
                    <tr key={f.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-1 text-[var(--muted)]">{f.visitLabel || f.updatedAt.slice(0, 10)}</td>
                      <td className="py-1 text-right font-medium text-[var(--ink)]">{f.totalScore}/100</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {facialPalsyHistory && facialPalsyHistory.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold text-[var(--muted)]">Facial Palsy — Sunnybrook score over time</div>
            <table className="w-full text-sm">
              <tbody>
                {[...facialPalsyHistory]
                  .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
                  .map((f) => (
                    <tr key={f.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-1 text-[var(--muted)]">{f.visitLabel || f.updatedAt.slice(0, 10)}</td>
                      <td className="py-1 text-right font-medium text-[var(--ink)]">
                        HB {f.hbGrade ?? '—'}
                        {f.sunnybrookScore != null ? ` · Sunnybrook ${f.sunnybrookScore}/100` : ''}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Activity">
        <div className="mb-3 flex gap-2 text-xs">
          {[
            { label: 'Today', days: 1 },
            { label: 'This week', days: 7 },
            { label: 'This month', days: 30 },
            { label: 'All time', days: undefined },
          ].map((preset) => (
            <button
              key={preset.label}
              onClick={() => setDaysBack(preset.days)}
              className={`rounded-full px-3 py-1 ${
                daysBack === preset.days
                  ? 'bg-[var(--teal)] text-white'
                  : 'bg-[var(--paper)] text-[var(--muted)] hover:bg-[var(--border)]'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {!activity || activity.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No activity in this window.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {activity.map((item) => (
              <li key={`${item.kind}:${item.id}`} className="flex items-center gap-3 py-2">
                <Pill tone={KIND_TONES[item.kind]}>{KIND_LABELS[item.kind]}</Pill>
                <span className="flex-1 text-sm text-[var(--ink)]">{item.summary}</span>
                <span className="text-xs text-[var(--muted)]">{item.at.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
