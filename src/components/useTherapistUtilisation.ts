import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { monthDateRange, type FyMonth } from '@/domain/fiscalYear';
import { minutesOfDay, toLocalDateStr } from '@/domain/schedule';
import { therapistUtilisation, type Utilisation } from '@/domain/utilisation';
import type { WorkingHours } from '@/domain/types';

/** Per-therapist utilisation for one month, keyed by therapist id. Undefined while loading, when disabled, or for a month that hasn't started. */
export function useTherapistUtilisation(
  month: FyMonth | undefined,
  therapists: { id: string; workingHours?: WorkingHours | null }[] | undefined,
  enabled: boolean
): Map<string, Utilisation> | undefined {
  const clinic = useClinic();
  return useLiveQuery(
    async () => {
      if (!enabled || !month || !therapists?.length) return undefined;
      const { from, to } = monthDateRange(month);
      const now = new Date();
      const today = toLocalDateStr(now);
      if (from > today) return undefined;
      const asOf = today <= to ? { date: today, minutes: minutesOfDay(now.toISOString()) } : undefined;
      const [visits, closedDates] = await Promise.all([
        repos.visits.list({ clinicId: clinic.id }),
        repos.clinicClosedDates.listByClinic(clinic.id),
      ]);
      const inMonth = visits.filter((v) => v.visitDate >= from && v.visitDate <= to);
      const clinicHours = {
        startHour: clinic.bookingStartHour ?? 9,
        endHour: clinic.bookingEndHour ?? 17,
      };
      return new Map(
        therapists.map((t) => [
          t.id,
          therapistUtilisation({
            visits: inMonth,
            therapistId: t.id,
            workingHours: t.workingHours,
            from,
            to,
            clinicHours,
            closedWeekdays: clinic.closedWeekdays,
            closedDates,
            slotMinutes: clinic.slotDurationMinutes || 30,
            asOf,
          }),
        ])
      );
    },
    [
      clinic.id,
      clinic.bookingStartHour,
      clinic.bookingEndHour,
      clinic.closedWeekdays,
      clinic.slotDurationMinutes,
      enabled,
      month?.year,
      month?.month,
      therapists,
    ]
  );
}
