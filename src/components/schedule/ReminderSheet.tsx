import { useEffect, useMemo, useState } from 'react';
import { Field, btnSecondary, inputCls } from '@/components/ui';
import { bookingService } from '@/services';
import { patientMessage, therapistDayListMessage, timeOnlyLabel } from '@/domain/bookingMessages';
import { appointmentMinutes, appointmentStartsOnDate } from '@/domain/schedule';
import type { Appointment, UUID } from '@/domain/types';

type Therapist = { id: UUID; name: string; phone: string | null };

/**
 * Evening-before messages: a reminder to each patient, and one day list per
 * therapist. wa.me opens one chat per tap, so each row has its own Send and
 * ticks to "Sent" (this session only).
 */
export function ReminderSheet({
  open,
  initialDate,
  clinicName,
  appointments,
  therapists,
  slotMinutes,
  onClose,
}: {
  open: boolean;
  initialDate: string;
  clinicName: string;
  appointments: Appointment[];
  therapists: Therapist[];
  slotMinutes: number;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [tab, setTab] = useState<'patients' | 'therapists'>('patients');
  const [sent, setSent] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setDate(initialDate);
    setTab('patients');
    setSent(new Set());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, initialDate, onClose]);

  const day = useMemo(
    () =>
      appointments
        .filter((a) => appointmentStartsOnDate(a, date) && (a.status === 'confirmed' || a.status === 'rescheduled'))
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    [appointments, date]
  );
  const therapistById = useMemo(() => new Map(therapists.map((t) => [t.id, t])), [therapists]);
  const therapistRows = useMemo(
    () =>
      therapists
        .map((t) => ({ therapist: t, list: day.filter((a) => a.therapistId === t.id) }))
        .filter((row) => row.list.length > 0),
    [therapists, day]
  );

  if (!open) return null;
  const markSent = (key: string) => setSent((current) => new Set(current).add(key));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/45 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-sheet-title"
        className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] shadow-xl sm:max-w-lg sm:rounded-2xl sm:pb-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[var(--border)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="reminder-sheet-title" className="font-display text-lg font-semibold text-[var(--ink)]">Send reminders</h2>
              <p className="text-sm text-[var(--muted)]">Each Send opens WhatsApp with the message ready — one tap per person.</p>
            </div>
            <button type="button" className="min-h-11 px-2 text-sm text-[var(--muted)]" onClick={onClose}>Close</button>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="w-44">
              <Field label="Appointments on">
                <input type="date" className={inputCls} value={date} onChange={(event) => { setDate(event.target.value); setSent(new Set()); }} />
              </Field>
            </div>
            <div className="flex rounded-lg border border-[var(--border)] p-0.5" role="tablist" aria-label="Send to">
              {(['patients', 'therapists'] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="tab"
                  aria-selected={tab === candidate}
                  onClick={() => setTab(candidate)}
                  className={`min-h-9 rounded-md px-3 text-xs font-medium ${tab === candidate ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)]'}`}
                >
                  {candidate === 'patients' ? `Patients (${day.length})` : `Therapists (${therapistRows.length})`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <ul className="flex-1 space-y-2 overflow-y-auto p-4 sm:p-5">
          {tab === 'patients' &&
            (day.length === 0 ? (
              <li className="py-6 text-center text-sm text-[var(--muted)]">No upcoming appointments on this day.</li>
            ) : (
              day.map((a) => {
                const done = sent.has(`p:${a.id}`);
                const therapist = a.therapistId ? therapistById.get(a.therapistId) : undefined;
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[var(--ink)]">{a.patientName}</span>
                      <span className="block text-xs text-[var(--muted)]">
                        {timeOnlyLabel(a.scheduledAt)}{therapist ? ` · ${therapist.name}` : ''}
                        {!a.patientPhone && ' · no phone'}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={!a.patientPhone}
                      className={done ? `${btnSecondary} shrink-0` : 'min-h-11 shrink-0 rounded-lg bg-[var(--teal)] px-4 text-sm font-medium text-white disabled:opacity-40'}
                      onClick={() => {
                        bookingService.sendText(
                          patientMessage('reminder', { patientName: a.patientName, clinicName, scheduledAt: a.scheduledAt, therapistName: therapist?.name }),
                          a.patientPhone
                        );
                        markSent(`p:${a.id}`);
                      }}
                    >
                      {done ? 'Sent ✓' : 'Send'}
                    </button>
                  </li>
                );
              })
            ))}
          {tab === 'therapists' &&
            (therapistRows.length === 0 ? (
              <li className="py-6 text-center text-sm text-[var(--muted)]">No therapist has appointments on this day.</li>
            ) : (
              therapistRows.map(({ therapist, list }) => {
                const done = sent.has(`t:${therapist.id}`);
                return (
                  <li key={therapist.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[var(--ink)]">{therapist.name}</span>
                      <span className="block text-xs text-[var(--muted)]">
                        {list.length} appointment{list.length === 1 ? '' : 's'} · from {timeOnlyLabel(list[0].scheduledAt)}
                        {!therapist.phone && ' · no phone on file'}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={!therapist.phone}
                      className={done ? `${btnSecondary} shrink-0` : 'min-h-11 shrink-0 rounded-lg bg-[var(--teal)] px-4 text-sm font-medium text-white disabled:opacity-40'}
                      onClick={() => {
                        bookingService.sendText(
                          therapistDayListMessage({
                            therapistName: therapist.name,
                            date,
                            appointments: list.map((a) => ({
                              scheduledAt: a.scheduledAt,
                              patientName: a.patientName,
                              durationMinutes: appointmentMinutes(a, slotMinutes),
                            })),
                          }),
                          therapist.phone
                        );
                        markSent(`t:${therapist.id}`);
                      }}
                    >
                      {done ? 'Sent ✓' : 'Send list'}
                    </button>
                  </li>
                );
              })
            ))}
        </ul>
      </div>
    </div>
  );
}
