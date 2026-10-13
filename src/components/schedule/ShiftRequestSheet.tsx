import { useEffect, useId, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { WorkingHoursSheet } from './WorkingHoursSheet';
import { BreakPlacementControl } from './BreakPlacementControl';
import { ErrorNote, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import { useMySchedule, formatScheduleDate } from '@/features/me/useMySchedule';
import type { UUID, WorkingHours } from '@/domain/types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Therapist self-service hours editing, replacing the direct
 * `setWorkingHours` write (removed server-side — see Task 3): picking a
 * shift template + weekdays submits a *request* via
 * `requestShiftAssignment` for an admin to approve, rather than writing
 * hours directly. "My hours don't match any shift" falls through to the
 * existing `WorkingHoursSheet` (reused unchanged), rewired to request
 * custom hours instead of saving them directly.
 */
export function ShiftRequestSheet({
  open, therapistId, therapistName, clinicId, clinic, currentWorkingHours, onClose,
}: {
  open: boolean;
  therapistId: UUID;
  therapistName: string;
  clinicId: UUID;
  /** The therapist's hours in effect now — pre-fills the custom-hours fallback. */
  currentWorkingHours: WorkingHours | null;
  clinic: { startHour: number; endHour: number; closedWeekdays?: number[] };
  onClose: () => void;
}) {
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinicId), [clinicId]);
  const schedule = useMySchedule(therapistId, clinicId, currentWorkingHours);
  const [shiftId, setShiftId] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [customMode, setCustomMode] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    setShiftId(''); setWeekdays([]); setCustomMode(false); setSubmitted(false); setError(null); setBusy(false);
  }, [open]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  if (customMode) {
    return (
      <WorkingHoursSheet
        open
        therapistName={therapistName}
        value={currentWorkingHours}
        clinic={clinic}
        onSave={async (hours) => {
          await bookingService.requestCustomHours(therapistId, hours);
          setSubmitted(true);
          // WorkingHoursSheet closes itself right after onSave resolves (other
          // callers rely on that), so confirm here before it does.
          window.alert('Submitted — waiting on approval. Your current hours stay in effect until then.');
        }}
        onClose={onClose}
      />
    );
  }

  async function submit() {
    if (!shiftId || weekdays.length === 0) return setError('Pick a shift and at least one day.');
    setBusy(true);
    setError(null);
    try {
      await bookingService.requestShiftAssignment({ therapistId, shiftTemplateId: shiftId, weekdays });
      setSubmitted(true);
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/45 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full rounded-t-2xl bg-[var(--surface)] p-4 sm:max-w-md sm:rounded-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId} className="font-display text-lg font-semibold text-[var(--ink)]">My working hours</h2>
        {schedule && (
          <div data-testid="current-schedule-block" className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-3">
            <h3 className="text-sm font-semibold text-[var(--ink)]">{schedule.headline}</h3>
            {schedule.lastChange && (
              <p className="mt-0.5 text-xs text-[var(--muted)]">{schedule.lastChange.text}</p>
            )}
            <div className="mt-2 divide-y divide-[var(--border)]/60 text-xs">
              {schedule.weekList.map((d) => (
                <div key={d.weekday} className="flex items-center justify-between py-1">
                  <span className="font-medium text-[var(--ink)]">{d.label}</span>
                  <span className={d.text === 'Off' || d.text === 'Closed' ? 'text-[var(--muted)]' : 'text-[var(--ink)]'}>
                    {d.text}
                  </span>
                </div>
              ))}
            </div>
            {schedule.pending && (
              <div className="mt-2.5 rounded border border-[var(--teal)]/30 bg-[var(--teal-light)] p-2 text-xs text-[var(--ink)]">
                <p className="font-medium">Request pending: {schedule.pending.title}</p>
                <p className="text-[var(--muted)]">Sent on {formatScheduleDate(schedule.pending.sentAt)}</p>
              </div>
            )}
            {schedule.declined && (
              <div className="mt-2.5 rounded border border-[var(--rust)]/30 bg-[var(--rust-light)] p-2 text-xs text-[var(--ink)]">
                <p className="font-medium">Declined: {schedule.declined.title}</p>
                <p className="text-[var(--muted)]">
                  {schedule.declined.decisionNote
                    ? `Declined on ${formatScheduleDate(schedule.declined.decidedAt)}: “${schedule.declined.decisionNote}”`
                    : `Declined on ${formatScheduleDate(schedule.declined.decidedAt)}`}
                </p>
              </div>
            )}
          </div>
        )}
        <div className="mt-3">
          <BreakPlacementControl therapistId={therapistId} clinicId={clinicId} />
        </div>
        {submitted ? (
          <p className="mt-3 text-sm text-[var(--ink)]">Submitted — waiting on approval. Your current hours stay in effect until then.</p>
        ) : (templates ?? []).length === 0 ? (
          <div>
            <p className="mt-2 text-sm text-[var(--muted)]">No shift templates set up yet.</p>
            <button type="button" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-[var(--teal)] underline" onClick={() => setCustomMode(true)}>Set custom hours instead</button>
          </div>
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-3">
              <select className={inputCls} aria-label="Shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
                <option value="">Pick a shift…</option>
                {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_LABELS.map((label, day) => (
                  <label key={day} className="inline-flex min-h-11 items-center gap-1 text-sm">
                    <input type="checkbox" checked={weekdays.includes(day)} onChange={(e) => setWeekdays((c) => e.target.checked ? [...c, day] : c.filter((d) => d !== day))} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <button type="button" className="mt-2 inline-flex min-h-11 items-center text-xs font-medium text-[var(--teal)] underline" onClick={() => setCustomMode(true)}>My hours don't match any shift</button>
            <ErrorNote message={error} />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className={btnPrimary} onClick={() => void submit()} disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
