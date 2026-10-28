import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { followUpMessage } from '@/domain/bookingMessages';
import { toLocalDateStr } from '@/domain/schedule';
import { formatDateDMY } from '@/domain/fiscalYear';
import type { FollowUpRow, NoShowRow } from '@/domain/followUp';
import type { UUID } from '@/domain/types';
import { notify } from '@/lib/notify';
import { toFriendlyMessage } from '@/lib/errors';
import { bookingService, patientService } from '@/services';
import type { FollowUpData } from './useFollowUpData';

type Filter = 'due' | 'missed' | 'no_shows';

const SENT_PREFIX = 'followup-messaged:';
/** "Messaged today" is a device-local nudge so two people at the desk don't both send it; never synced. */
function wasMessagedToday(patientId: UUID, today: string): boolean {
  try {
    return localStorage.getItem(`${SENT_PREFIX}${patientId}`) === today;
  } catch {
    return false;
  }
}
function markMessaged(patientId: UUID, today: string) {
  try {
    localStorage.setItem(`${SENT_PREFIX}${patientId}`, today);
  } catch {
    /* private mode: the tick just doesn't stick */
  }
}

export type BookFollowUp = { patientId: UUID; therapistId: UUID | null; date: string };

/**
 * The "Reviews" tab of the Workspace Follow up card. Due: reviews being acted on. Missed: past the reminder window, still
 * listed for a month. No-shows: recent no-shows nobody has rebooked. Each row: Message patient (one-tap WhatsApp),
 * Book (opens the booking sheet filled in) and, for reviews, Dismiss.
 */
export function ReviewsPanel({
  data,
  clinicName,
  canMessage,
  therapistNameFor,
  onBook,
}: {
  data: FollowUpData;
  clinicName: string;
  /** The clinic has patient messaging on. */
  canMessage: boolean;
  therapistNameFor: (id: UUID | null) => string | null;
  onBook: (target: BookFollowUp) => void;
}) {
  const today = toLocalDateStr(new Date());
  const [filter, setFilter] = useState<Filter>(data.due.length || !(data.missed.length || data.noShows.length) ? 'due' : data.missed.length ? 'missed' : 'no_shows');
  // Re-render after a tick without storing it anywhere shared.
  const [, bump] = useState(0);
  const chips: { key: Filter; label: string; count: number }[] = [
    { key: 'due', label: 'Due', count: data.due.length },
    { key: 'missed', label: 'Missed', count: data.missed.length },
    { key: 'no_shows', label: 'No-shows', count: data.noShows.length },
  ];

  function message(kind: 'due' | 'missed' | 'no_show', patient: { id: UUID; name: string; phone: string | null }, therapistId: UUID | null, date: string) {
    bookingService.sendText(
      followUpMessage(kind, { patientName: patient.name, clinicName, therapistName: therapistNameFor(therapistId), date }),
      patient.phone
    );
    markMessaged(patient.id, today);
    bump((n) => n + 1);
  }

  async function dismiss(patientId: UUID) {
    try {
      await patientService.setFollowUp(patientId, null);
    } catch (e) {
      notify.error(toFriendlyMessage(e));
    }
  }

  const messageButton = (
    kind: 'due' | 'missed' | 'no_show',
    patient: { id: UUID; name: string; phone: string | null; doNotMessage?: boolean },
    therapistId: UUID | null,
    date: string
  ) => {
    if (!canMessage) return null;
    const blocked = Boolean(patient.doNotMessage) || !patient.phone;
    const sent = wasMessagedToday(patient.id, today);
    return (
      <button
        type="button"
        disabled={blocked}
        title={patient.doNotMessage ? 'This patient asked not to be messaged' : !patient.phone ? 'No phone number on file' : undefined}
        className="min-h-9 rounded-full border border-[var(--border)] px-2.5 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)] disabled:opacity-40"
        onClick={() => message(kind, patient, therapistId, date)}
      >
        {sent ? 'Messaged ✓' : 'Message patient'}
      </button>
    );
  };

  const dueLine = (row: FollowUpRow) => {
    const days = Math.abs(row.daysFromDue);
    if (row.daysFromDue === 0) return 'due today';
    if (row.daysFromDue > 0) return `due in ${days} ${days === 1 ? 'day' : 'days'}`;
    return `overdue by ${days} ${days === 1 ? 'day' : 'days'}`;
  };

  const reviewRow = (row: FollowUpRow, kind: 'due' | 'missed') => {
    const p = row.patient;
    const therapistId = p.followUpTherapistId ?? null;
    return (
      <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5">
        <div className="min-w-0">
          <Link to="/patients/$patientId" params={{ patientId: p.id }} search={{ from: '/workspace' }} className="font-display text-sm font-medium text-[var(--ink)] hover:underline">
            {p.name}
          </Link>
          <p className={`text-xs ${row.daysFromDue < 0 && kind === 'due' ? 'text-[var(--rust)]' : 'text-[var(--muted)]'}`}>
            {kind === 'missed' ? `Missed · was due ${formatDateDMY(row.dueOn)}` : `${dueLine(row)} · ${formatDateDMY(row.dueOn)}`}
            {therapistNameFor(therapistId) ? ` · ${therapistNameFor(therapistId)}` : ''}
          </p>
          {p.followUpNote && <p className="text-xs text-[var(--ink)]">{p.followUpNote}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {messageButton(kind, p, therapistId, row.dueOn)}
          <button
            type="button"
            className="min-h-9 rounded-full bg-[var(--teal)] px-3 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
            onClick={() => onBook({ patientId: p.id, therapistId, date: row.dueOn >= today ? row.dueOn : today })}
          >
            Book
          </button>
          <button type="button" className="min-h-9 px-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--rust)]" onClick={() => void dismiss(p.id)}>
            Dismiss
          </button>
        </div>
      </li>
    );
  };

  const noShowRow = (row: NoShowRow) => {
    const a = row.appointment;
    const day = toLocalDateStr(new Date(a.scheduledAt));
    const patient = row.patient ?? { id: a.patientId ?? a.id, name: a.patientName, phone: a.patientPhone };
    return (
      <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5">
        <div className="min-w-0">
          <p className="font-display text-sm font-medium text-[var(--ink)]">{a.patientName}</p>
          <p className="text-xs text-[var(--muted)]">
            No-show · {formatDateDMY(day)}
            {therapistNameFor(a.therapistId) ? ` · ${therapistNameFor(a.therapistId)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {messageButton('no_show', patient, a.therapistId, day)}
          {row.patient && (
            <button
              type="button"
              className="min-h-9 rounded-full bg-[var(--teal)] px-3 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
              onClick={() => onBook({ patientId: row.patient!.id, therapistId: a.therapistId, date: today })}
            >
              Book
            </button>
          )}
        </div>
      </li>
    );
  };

  const empty: Record<Filter, string> = {
    due: 'No reviews due. After a visit, tap "Ask them back for a review?" on the Visit logged screen, or set one from a patient\'s profile.',
    missed: 'No missed reviews.',
    no_shows: 'No recent no-shows to rebook.',
  };
  const list = filter === 'due' ? data.due.map((r) => reviewRow(r, 'due')) : filter === 'missed' ? data.missed.map((r) => reviewRow(r, 'missed')) : data.noShows.map(noShowRow);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Reviews filter">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-pressed={filter === chip.key}
            onClick={() => setFilter(chip.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              filter === chip.key ? 'border-transparent bg-[var(--teal-light)] text-[var(--teal)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]'
            }`}
          >
            {chip.label}
            {chip.count ? ` (${chip.count})` : ''}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="py-5 text-center text-sm text-[var(--muted)]">{empty[filter]}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">{list}</ul>
      )}
    </div>
  );
}
