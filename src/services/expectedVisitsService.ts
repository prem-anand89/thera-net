import type { ExpectedVisit, ExpectedVisitStatus, UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';

/**
 * "Who's coming in today" — see the `expected_visits` migration and
 * `ExpectedVisit` doc comment for the full rationale (not a booking system).
 */
export function createExpectedVisitsService(repos: Repos) {
  return {
    listForToday(clinicId: UUID, today = new Date().toISOString().slice(0, 10)): Promise<ExpectedVisit[]> {
      return repos.expectedVisits.listForDate(clinicId, today);
    },

    async add(entry: {
      clinicId: UUID;
      patientId?: UUID | null;
      patientName?: string | null;
      timeNote: string;
      visitDate?: string;
    }): Promise<ExpectedVisit> {
      const expected: ExpectedVisit = {
        id: crypto.randomUUID(),
        clinicId: entry.clinicId,
        patientId: entry.patientId ?? null,
        patientName: entry.patientName ?? null,
        timeNote: entry.timeNote,
        visitDate: entry.visitDate ?? new Date().toISOString().slice(0, 10),
        status: 'expected',
        updatedAt: new Date().toISOString(),
      };
      await repos.expectedVisits.put(expected);
      return expected;
    },

    async setStatus(entry: ExpectedVisit, status: ExpectedVisitStatus): Promise<ExpectedVisit> {
      const updated: ExpectedVisit = { ...entry, status, updatedAt: new Date().toISOString() };
      await repos.expectedVisits.put(updated);
      return updated;
    },
  };
}
