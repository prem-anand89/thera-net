import type { UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';

/**
 * Unified, patient-centric activity feed — the core of the Patient Hub.
 * Visits and clinical notes each write their own local-first table; this
 * service normalizes them into one chronological stream so the patient
 * profile page doesn't need to know about each source individually.
 *
 * Reads local Dexie data only (via repos), matching the rest of the app's
 * offline-first design. Consent events are deliberately excluded — consents
 * are online-only (not in SYNC_TABLES), so they cannot be shown from local
 * data while offline; a future online-aware panel can query them separately.
 */

export type ActivityKind = 'visit' | 'consultation_note';

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
      const [visits, notes] = await Promise.all([
        repos.visits.list({ clinicId, patientId }),
        repos.consultationNotes.list(clinicId, patientId),
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
      ];

      const filtered = daysBack == null ? items : items.filter((i) => withinDays(i.at, daysBack));
      return filtered.sort((a, b) => b.at.localeCompare(a.at));
    },
  };
}

function withinDays(isoDateOrTimestamp: string, days: number): boolean {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return new Date(isoDateOrTimestamp) >= cutoff;
}
