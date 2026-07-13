import type { UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';

/**
 * Unified, patient-centric activity feed — the core of the Patient Hub.
 * Clinical notes (and any future non-visit event kind) write their own
 * local-first table; this service normalizes them into one chronological
 * stream so the patient profile page doesn't need to know about each
 * source individually. Visits are deliberately excluded here — they get
 * their own richer Visit history table on the Patient Hub (date, service,
 * package progress, bill, invoice status), which a one-line "Visit logged"
 * summary can't carry.
 *
 * Reads local Dexie data only (via repos), matching the rest of the app's
 * offline-first design. Consent events are deliberately excluded — consents
 * are online-only (not in SYNC_TABLES), so they cannot be shown from local
 * data while offline; a future online-aware panel can query them separately.
 */

export type ActivityKind = never;

export interface ActivityItem {
  kind: ActivityKind;
  id: UUID;
  at: string; // ISO timestamp/date used for sorting, most-recent-first
  summary: string;
  detailHref?: string;
}

export function createPatientActivityService(_repos: Repos) {
  return {
    /**
     * Full cross-module activity for one patient, most recent first.
     * daysBack limits the window; omit for full history.
     * (Currently empty; consultation notes have been removed.)
     */
    async getActivityForPatient(
      _clinicId: UUID,
      _patientId: UUID,
      _daysBack?: number
    ): Promise<ActivityItem[]> {
      return [];
    },
  };
}
