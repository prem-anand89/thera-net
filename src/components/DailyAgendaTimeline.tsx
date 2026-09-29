import { useMemo } from 'react';
import type { Appointment } from '@/domain/types';

interface DailyAgendaTimelineProps {
  date: string; // YYYY-MM-DD
  appointments: Appointment[];
  slotDurationMinutes: number;
  therapistNameById?: Map<string, string>;
  onBookSlot: (date: string, time: string) => void;
}

export function DailyAgendaTimeline({
  date,
  appointments,
  slotDurationMinutes,
  therapistNameById,
  onBookSlot,
}: DailyAgendaTimelineProps) {
  // Generate time slots based on slotDurationMinutes
  const slots = useMemo(() => {
    const list = [];
    const startHour = 8; // e.g., 8 AM
    const endHour = 18; // e.g., 6 PM

    for (let h = startHour; h < endHour; h++) {
      for (let m = 0; m < 60; m += slotDurationMinutes) {
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
        const label = `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${String(m).padStart(2, '0')} ${
          h >= 12 ? 'PM' : 'AM'
        }`;
        list.push({ timeStr, label });
      }
    }
    return list;
  }, [slotDurationMinutes]);

  // Map of booked appointments by time string
  const bookedMap = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      if (!a.scheduledAt) continue;
      
      const aDate = new Date(a.scheduledAt);
      const aDateStr =
        aDate.getFullYear() +
        '-' +
        String(aDate.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(aDate.getDate()).padStart(2, '0');

      if (aDateStr !== date) continue;

      const timeStr =
        String(aDate.getHours()).padStart(2, '0') +
        ':' +
        String(aDate.getMinutes()).padStart(2, '0') +
        ':00';

      const existing = map.get(timeStr) ?? [];
      existing.push(a);
      map.set(timeStr, existing);
    }
    return map;
  }, [appointments, date]);

  return (
    <div className="flex flex-col space-y-2 p-4">
      {slots.map((slot) => {
        const booked = bookedMap.get(slot.timeStr) || [];
        
        if (booked.length > 0) {
          // Booked slots
          return (
            <div key={slot.timeStr} className="flex min-h-[80px] gap-4">
              {/* Time Label */}
              <div className="w-16 shrink-0 text-right pt-2 text-xs font-semibold text-[var(--muted)]">
                {slot.label}
              </div>
              
              {/* Appointments (could be multiple if overlapping therapists, though handled by BookSlotSheet) */}
              <div className="flex flex-1 flex-col gap-2">
                {booked.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-col justify-center rounded-xl border border-[var(--teal)]/20 bg-[var(--teal)]/5 p-3"
                  >
                    <div className="font-semibold text-[var(--ink)]">{a.patientName}</div>
                    <div className="text-xs text-[var(--muted)]">
                      with {a.therapistId ? therapistNameById?.get(a.therapistId) || 'Staff' : 'Staff'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        // Empty slot
        return (
          <div key={slot.timeStr} className="group flex min-h-[40px] gap-4">
            <div className="w-16 shrink-0 text-right pt-1.5 text-xs font-semibold text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100">
              {slot.label}
            </div>
            <div className="flex-1 flex items-center border-t border-dashed border-[var(--border)] pt-1.5">
              <button
                type="button"
                onClick={() => onBookSlot(date, slot.timeStr)}
                className="opacity-0 group-hover:opacity-100 flex items-center gap-1 rounded-full bg-[var(--paper)] px-3 py-1 text-xs font-semibold text-[var(--teal)] hover:bg-[var(--teal)] hover:text-white transition-all"
              >
                <span>+</span> Book
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
