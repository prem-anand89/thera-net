import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { ErrorNote, inputCls, btnPrimary } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import { minutesToTime } from '@/domain/schedule';
import type { ShiftTemplate, TherapistShiftAssignment, Therapist, WorkingHours } from '@/domain/types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon: 09:00–13:00, Wed: 14:00–18:00" — only weekdays present in the hours. */
function summarizeCustomHours(hours: WorkingHours): string {
  const parts: string[] = [];
  for (let day = 0; day < 7; day++) {
    const intervals = hours[String(day) as keyof WorkingHours];
    if (!intervals) continue;
    const ranges = intervals.length === 0
      ? 'off'
      : intervals.map(([s, e]) => `${minutesToTime(s)}–${minutesToTime(e)}`).join(' & ');
    parts.push(`${WEEKDAY_LABELS[day]}: ${ranges}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'No working days';
}

function summarize(assignment: TherapistShiftAssignment | undefined, templateById: Map<string, ShiftTemplate>): string {
  if (!assignment) return 'No shift assigned';
  if (assignment.shiftTemplateId) {
    const t = templateById.get(assignment.shiftTemplateId);
    const days = (assignment.weekdays ?? []).map((d) => WEEKDAY_LABELS[d]).join('/');
    return `${t?.name ?? 'Unknown shift'} — ${days}`;
  }
  // A custom-hours row whose custom_hours is the JSON-null sentinel
  // ('null'::jsonb server-side) arrives here as JS null: it's a request to
  // reset to clinic hours (working_hours = null), not real hours.
  if (assignment.customHours === null) return 'Reset to clinic hours';
  return `Custom hours — ${summarizeCustomHours(assignment.customHours)}`;
}

function TherapistShiftRow({
  therapist, templates, approved, pending,
}: {
  therapist: Therapist;
  templates: ShiftTemplate[];
  approved: TherapistShiftAssignment[];
  pending: TherapistShiftAssignment | undefined;
}) {
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const [shiftId, setShiftId] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [deciding, setDeciding] = useState(false);
  // Ref guard as well as state: two taps in the same tick both see the
  // pre-render `deciding === false`, so state alone can't block the second.
  const decidingRef = useRef(false);
  const [declineReason, setDeclineReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    if (!shiftId || weekdays.length === 0) return;
    setAssigning(true);
    setError(null);
    try {
      await bookingService.assignShift({ therapistId: therapist.id, shiftTemplateId: shiftId, weekdays });
      setShiftId('');
      setWeekdays([]);
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setAssigning(false);
    }
  }

  async function decide(action: 'approve' | 'decline', requestId: string) {
    if (decidingRef.current) return;
    decidingRef.current = true;
    setDeciding(true);
    setError(null);
    try {
      if (action === 'approve') await bookingService.approveShiftAssignment(requestId);
      else await bookingService.declineShiftAssignment(requestId, declineReason.trim() || null);
      setDeclineReason('');
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      decidingRef.current = false;
      setDeciding(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2">
      <p className="font-medium text-[var(--ink)]">{therapist.name}</p>
      <p className="text-sm text-[var(--muted)]">{approved.map((a) => summarize(a, templateById)).join('; ') || 'No shift assigned'}</p>

      {pending && (
        <div className="rounded-lg bg-[var(--amber-light)] p-2 text-sm">
          <p className="font-medium text-[var(--amber)]">Pending: {summarize(pending, templateById)}</p>
          {pending.note && <p className="mt-1 text-xs text-[var(--ink)]">Note: {pending.note}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs font-medium">
            <button
              type="button"
              className="inline-flex min-h-11 items-center px-1 text-[var(--teal)] disabled:opacity-50"
              disabled={deciding}
              onClick={() => void decide('approve', pending.id)}
            >
              Approve
            </button>
            <input
              className={`${inputCls} max-w-56`}
              placeholder="Decline reason (optional)"
              aria-label={`Decline reason for ${therapist.name}`}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              disabled={deciding}
            />
            <button
              type="button"
              className="inline-flex min-h-11 items-center px-1 text-[var(--rust)] disabled:opacity-50"
              disabled={deciding}
              onClick={() => void decide('decline', pending.id)}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select className={inputCls} aria-label={`Shift to assign to ${therapist.name}`} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
          <option value="">Assign a shift…</option>
          {templates.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {WEEKDAY_LABELS.map((label, day) => (
          <label key={day} className="inline-flex min-h-11 items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={weekdays.includes(day)}
              onChange={(e) => setWeekdays((current) => (e.target.checked ? [...current, day] : current.filter((d) => d !== day)))}
            />
            {label}
          </label>
        ))}
        <button type="button" className={btnPrimary} onClick={() => void assign()} disabled={assigning || !shiftId || weekdays.length === 0}>
          {assigning ? 'Assigning…' : 'Assign'}
        </button>
      </div>
      <ErrorNote message={error} />
    </div>
  );
}

export function ShiftAssignmentsSection() {
  const clinic = useClinic();
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinic.id, true), [clinic.id]);
  const assignments = useLiveQuery(() => repos.therapistShiftAssignments.listByClinic(clinic.id), [clinic.id]);

  if (!therapists || !templates || !assignments) return null;

  return (
    <div className="space-y-3">
      <h2 className="font-display text-lg font-semibold text-[var(--ink)]">Shift assignments</h2>
      {templates.length === 0 && (
        <p className="text-sm text-[var(--muted)]">No shift templates yet — add one above, or use custom hours per therapist.</p>
      )}
      <div className="space-y-2">
        {therapists.filter((t) => t.active !== false).map((therapist) => (
          <TherapistShiftRow
            key={therapist.id}
            therapist={therapist}
            templates={templates}
            approved={assignments.filter((a) => a.therapistId === therapist.id && a.status === 'approved')}
            pending={assignments.find((a) => a.therapistId === therapist.id && a.status === 'pending')}
          />
        ))}
      </div>
    </div>
  );
}
