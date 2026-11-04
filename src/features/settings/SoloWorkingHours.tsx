import { useMemo, useState } from 'react';
import { SectionCard, btnPrimary } from '@/components/ui';
import { ShiftSheet } from './ShiftSheet';
import { WEEKDAY_META, WEEKDAY_ORDER, buildCoverage, calculateWeeklyTotal, describeSchedule } from './shiftUtils';
import type { Clinic, ShiftTemplate, Therapist, TherapistShiftAssignment } from '@/domain/types';

/**
 * Team → Shifts for a clinic with one therapist: no roster tools, just their week and one button. Same hours sheet as
 * the full view (Own hours | Clinic hours, plus Shift type when the clinic already has shift types).
 */
export function SoloWorkingHours({
  therapist,
  templates,
  approvedAssignments,
  clinic,
}: {
  therapist: Therapist;
  templates: ShiftTemplate[];
  approvedAssignments: TherapistShiftAssignment[];
  clinic: Clinic;
}) {
  const [open, setOpen] = useState(false);
  const coverage = useMemo(
    () => buildCoverage([therapist], approvedAssignments, templates, clinic),
    [therapist, approvedAssignments, templates, clinic]
  );
  const days = coverage.get(therapist.id);
  const weekly = calculateWeeklyTotal(therapist.id, coverage);
  const desc = describeSchedule(therapist, approvedAssignments.filter((a) => a.therapistId === therapist.id), templates, clinic);

  return (
    <SectionCard
      id="settings-card-team-working-hours"
      title="Working hours"
      action={
        <button type="button" className={`${btnPrimary} min-h-9 px-3 text-sm`} onClick={() => setOpen(true)}>
          Edit hours
        </button>
      }
    >
      <div data-testid="solo-working-hours">
        <p className="text-sm font-medium text-[var(--ink)]">{desc.headline}</p>
        <p className="mb-3 text-xs text-[var(--muted)]">
          {desc.summary} · {weekly.totalHours}h a week. Online booking only offers these times.
        </p>
        <ul className="overflow-hidden rounded-xl border border-[var(--border)]">
          {WEEKDAY_ORDER.map((day) => {
            const cell = days?.get(day);
            const text =
              cell?.type === 'clinic_closed' ? 'Clinic closed' : !cell || cell.workingMinutes <= 0 ? 'Off' : cell.label;
            const on = Boolean(cell && cell.workingMinutes > 0);
            return (
              <li key={day} className="flex min-h-10 items-center justify-between border-t border-[var(--border)] px-3 py-1.5 text-sm first:border-t-0">
                <span className="text-[var(--ink)]">{WEEKDAY_META[day].full}</span>
                <span className={on ? 'font-medium text-[var(--ink)]' : 'text-[var(--muted)]'}>{text}</span>
              </li>
            );
          })}
        </ul>
      </div>
      {open && <ShiftSheet open therapistId={therapist.id} onClose={() => setOpen(false)} />}
    </SectionCard>
  );
}
