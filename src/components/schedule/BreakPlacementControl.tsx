import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { inputCls } from '@/components/ui';
import type { UUID } from '@/domain/types';

function minutesToTimeInput(m: number): string {
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
}
function timeInputToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Self-service control letting a therapist (or admin, viewing their own
 * account) move their break within an already-approved shift. Unlike the
 * hours-change flow (ShiftRequestSheet), this writes immediately via
 * bookingService.setBreakPlacement — no approval needed, since moving a
 * fixed-duration break never changes total capacity. Renders nothing when
 * the therapist has no approved shift-template assignment whose template
 * actually has a break (breakDurationMinutes > 0); custom-hours assignments
 * (no shiftTemplateId) have no template-level break to move.
 */
export function BreakPlacementControl({ therapistId, clinicId }: { therapistId: UUID; clinicId: UUID }) {
  const assignments = useLiveQuery(() => repos.therapistShiftAssignments.listByTherapist(therapistId), [therapistId]);
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinicId), [clinicId]);
  const [saved, setSaved] = useState<string | null>(null);

  const templateById = new Map((templates ?? []).map((t) => [t.id, t]));
  const movable = (assignments ?? []).filter((a) => {
    if (a.status !== 'approved' || !a.shiftTemplateId) return false;
    const t = templateById.get(a.shiftTemplateId);
    return (t?.breakDurationMinutes ?? 0) > 0;
  });

  if (movable.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[var(--muted)]">Break time</p>
      {movable.map((a) => {
        const t = templateById.get(a.shiftTemplateId!)!;
        const current = a.breakStartMinute ?? t.defaultBreakStartMinute ?? t.startMinute;
        return (
          <div key={a.id} className="flex items-center gap-2 text-sm">
            <span className="text-[var(--muted)]">{t.name}</span>
            <input
              type="time"
              className={inputCls}
              defaultValue={minutesToTimeInput(current)}
              onBlur={async (e) => {
                await bookingService.setBreakPlacement(a.id, timeInputToMinutes(e.target.value));
                setSaved(a.id);
                setTimeout(() => setSaved((s) => (s === a.id ? null : s)), 2000);
              }}
            />
            {saved === a.id && <span className="text-xs text-[var(--teal)]">Saved</span>}
          </div>
        );
      })}
    </div>
  );
}
