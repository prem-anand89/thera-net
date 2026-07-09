import type { UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';

/**
 * Unified, patient-centric activity feed — the core of the Patient Hub.
 * Every module (visits, clinical notes, screenings) writes its own local-first
 * table; this service normalizes them into one chronological stream so the
 * patient profile page doesn't need to know about each module individually.
 *
 * Reads local Dexie data only (via repos), matching the rest of the app's
 * offline-first design. Consent events are deliberately excluded — consents
 * are online-only (not in SYNC_TABLES), so they cannot be shown from local
 * data while offline; a future online-aware panel can query them separately.
 */

export type ActivityKind =
  | 'visit'
  | 'consultation_note'
  | 'module_enrollment'
  | 'screening_response'
  | 'return_to_sport_response'
  | 'scoliosis_screening_response'
  | 'face_scale_response'
  | 'facial_palsy_assessment';

export interface ActivityItem {
  kind: ActivityKind;
  id: UUID;
  at: string; // ISO timestamp/date used for sorting, most-recent-first
  summary: string;
  detailHref?: string;
}

export function createPatientActivityService(repos: Repos) {
  return {
    /**
     * Full cross-module activity for one patient, most recent first.
     * daysBack limits the window; omit for full history.
     */
    async getActivityForPatient(
      clinicId: UUID,
      patientId: UUID,
      daysBack?: number
    ): Promise<ActivityItem[]> {
      const [visits, notes, enrollments, screenings, rts, scoliosis, faceScale, facialPalsy] = await Promise.all([
        repos.visits.list({ clinicId, patientId }),
        repos.consultationNotes.list(clinicId, patientId),
        repos.moduleEnrollments.list(clinicId, patientId),
        repos.screeningResponses.list(clinicId, patientId),
        repos.returnToSport.list(clinicId, patientId),
        repos.scoliosisScreening.list(clinicId, patientId),
        repos.faceScale.list(clinicId, patientId),
        repos.facialPalsy.list(clinicId, patientId),
      ]);

      const items: ActivityItem[] = [
        ...visits
          .filter((v) => !v.deleted)
          .map((v) => ({
            kind: 'visit' as const,
            id: v.id,
            at: v.visitDate,
            summary: v.condition ? `Visit — ${v.condition}` : 'Visit logged',
          })),
        ...notes.map((n) => ({
          kind: 'consultation_note' as const,
          id: n.id,
          at: n.updatedAt,
          summary: `Consultation note (${n.status})`,
        })),
        ...enrollments.map((e) => ({
          kind: 'module_enrollment' as const,
          id: e.id,
          at: e.enrolledAt,
          summary: `Enrolled in ${moduleLabel(e.moduleType)} (${e.status})`,
        })),
        ...screenings.map((s) => ({
          kind: 'screening_response' as const,
          id: s.id,
          at: s.updatedAt,
          summary: `Gut Screening${s.triageLevel ? ` — ${s.triageLevel}` : ''}`,
        })),
        ...rts.map((r) => ({
          kind: 'return_to_sport_response' as const,
          id: r.id,
          at: r.updatedAt,
          summary: `Return to Sport${r.riskCategory ? ` — ${r.riskCategory}` : ''}`,
        })),
        ...scoliosis.map((s) => ({
          kind: 'scoliosis_screening_response' as const,
          id: s.id,
          at: s.updatedAt,
          summary: `Scoliosis Screening${s.severityLevel ? ` — ${s.severityLevel}` : ''}`,
        })),
        ...faceScale.map((f) => ({
          kind: 'face_scale_response' as const,
          id: f.id,
          at: f.updatedAt,
          summary: `FaCE Scale — ${f.totalScore}/100`,
        })),
        ...facialPalsy.map((f) => ({
          kind: 'facial_palsy_assessment' as const,
          id: f.id,
          at: f.updatedAt,
          summary: `Facial Palsy — HB ${f.hbGrade ?? '—'}${f.sunnybrookScore != null ? `, Sunnybrook ${f.sunnybrookScore}/100` : ''}`,
        })),
      ];

      const filtered = daysBack == null ? items : items.filter((i) => withinDays(i.at, daysBack));
      return filtered.sort((a, b) => b.at.localeCompare(a.at));
    },

    /** Which modules a patient is currently (or has ever been) enrolled in. */
    async getEnrollments(clinicId: UUID, patientId: UUID) {
      return repos.moduleEnrollments.list(clinicId, patientId);
    },
  };
}

function moduleLabel(moduleType: string): string {
  switch (moduleType) {
    case 'gut_screening':
      return 'Gut Screening';
    case 'return_to_sport':
      return 'Return to Sport';
    case 'scoliosis_screening':
      return 'Scoliosis Screening';
    case 'face_scale':
      return 'FaCE Scale';
    case 'facial_palsy':
      return 'Facial Palsy';
    default:
      return moduleType;
  }
}

function withinDays(isoDateOrTimestamp: string, days: number): boolean {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return new Date(isoDateOrTimestamp) >= cutoff;
}
