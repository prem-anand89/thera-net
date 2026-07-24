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

export type ActivityKind = 'consultation_note';

export interface ActivityItem {
  kind: ActivityKind;
  id: UUID;
  at: string; // ISO timestamp/date used for sorting, most-recent-first
  summary: string;
  detailHref?: string;
}

function noteSummary(status: string, notesText: string | null): string {
  const verb = status === 'draft' ? 'Note drafted' : status === 'completed' ? 'Note completed' : 'Note archived';
  const preview = notesText?.trim().slice(0, 80);
  return preview ? `${verb} — ${preview}${notesText!.trim().length > 80 ? '…' : ''}` : verb;
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
      const notes = await repos.consultationNotes.listByPatient(clinicId, patientId);
      const cutoff = daysBack != null ? Date.now() - daysBack * 24 * 60 * 60 * 1000 : null;

      return notes
        .filter((n) => cutoff == null || new Date(n.updatedAt).getTime() >= cutoff)
        .map((n) => ({
          kind: 'consultation_note' as const,
          id: n.id,
          at: n.updatedAt,
          summary: noteSummary(n.status, n.notesText),
          detailHref: `/patients/${patientId}/notes/${n.id}`,
        }))
        .sort((a, b) => b.at.localeCompare(a.at));
    },
  };
}
