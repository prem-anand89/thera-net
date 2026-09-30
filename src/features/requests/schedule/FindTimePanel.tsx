import type { Appointment, UUID } from '@/domain/types';
import { freeGaps, minutesLabel, minutesToTime, type ClosedDayInfo } from '@/domain/schedule';

/**
 * Calendly-style: free start times as buttons, grouped by therapist, for one
 * day. Replaces scanning a wide grid on phones.
 */
export function FindTimePanel({
  date,
  therapists,
  appointments,
  hours,
  slotMinutes,
  closed,
  nowMinutes,
  onPick,
}: {
  date: string;
  therapists: { id: UUID; name: string; color: string }[];
  appointments: Appointment[];
  hours: { startHour: number; endHour: number };
  slotMinutes: number;
  closed: ClosedDayInfo;
  /** Minutes after midnight when `date` is today; past times are skipped. */
  nowMinutes: number | null;
  onPick: (input: { therapistId: UUID; time: string }) => void;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-label="Free times">
      {closed.closed && (
        <p className="rounded-lg bg-[var(--slate-light)] p-2 text-sm text-[var(--slate)]">
          The clinic is closed{closed.label ? ` (${closed.label})` : ''} — you can still book if needed.
        </p>
      )}
      {therapists.map((therapist) => {
        const starts = freeGaps(appointments, therapist.id, date, hours, slotMinutes, {
          notBefore: nowMinutes ?? undefined,
        }).flatMap((gap) => {
          const result: number[] = [];
          for (let at = gap.start; at + slotMinutes <= gap.end; at += slotMinutes) result.push(at);
          return result;
        });
        return (
          <div key={therapist.id}>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[var(--ink)]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: therapist.color }} aria-hidden />
              {therapist.name}
              <span className="text-xs font-normal text-[var(--muted)]">· {starts.length} free</span>
            </p>
            {starts.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">No free time this day.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {starts.map((at) => (
                  <button
                    key={at}
                    type="button"
                    onClick={() => onPick({ therapistId: therapist.id, time: minutesToTime(at) })}
                    className="min-h-11 rounded-lg border border-[var(--moss)]/40 bg-[var(--moss-light)] text-xs font-medium text-[var(--moss-strong)] hover:border-[var(--moss)]"
                  >
                    {minutesLabel(at)}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
