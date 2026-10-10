import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { inputCls, btnPrimary } from '@/components/ui';
import type { ShiftTemplate, TherapistShiftAssignment, Therapist } from '@/domain/types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function summarize(assignment: TherapistShiftAssignment | undefined, templateById: Map<string, ShiftTemplate>): string {
  if (!assignment) return 'No shift assigned';
  if (assignment.shiftTemplateId) {
    const t = templateById.get(assignment.shiftTemplateId);
    const days = (assignment.weekdays ?? []).map((d) => WEEKDAY_LABELS[d]).join('/');
    return `${t?.name ?? 'Unknown shift'} — ${days}`;
  }
  return 'Custom hours';
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

  async function assign() {
    if (!shiftId || weekdays.length === 0) return;
    setAssigning(true);
    try {
      await bookingService.assignShift({ therapistId: therapist.id, shiftTemplateId: shiftId, weekdays });
      setShiftId('');
      setWeekdays([]);
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2">
      <p className="font-medium text-[var(--ink)]">{therapist.name}</p>
      <p className="text-sm text-[var(--muted)]">{approved.map((a) => summarize(a, templateById)).join('; ') || 'No shift assigned'}</p>

      {pending && (
        <div className="rounded-lg bg-[var(--amber-light)] p-2 text-sm">
          <p className="font-medium text-[var(--amber)]">Pending: {summarize(pending, templateById)}</p>
          <div className="mt-1 flex gap-3 text-xs font-medium">
            <button
              type="button"
              className="inline-flex min-h-11 items-center px-1 text-[var(--teal)]"
              onClick={() => void bookingService.approveShiftAssignment(pending.id)}
            >
              Approve
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center px-1 text-[var(--rust)]"
              onClick={() => void bookingService.declineShiftAssignment(pending.id)}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select className={inputCls} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
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
