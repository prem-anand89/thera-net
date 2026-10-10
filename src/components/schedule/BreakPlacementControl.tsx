import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { ErrorNote, inputCls } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import type { UUID } from '@/domain/types';

function minutesToTimeInput(m: number): string {
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
}
/** NaN for an empty/partial value (a cleared <input type="time">). */
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
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  async function save(assignmentId: UUID, value: string) {
    const minutes = timeInputToMinutes(value);
    if (!Number.isFinite(minutes)) {
      // Never send a cleared value: it would reach the RPC as null.
      setError({ id: assignmentId, message: 'Enter a break start time.' });
      return;
    }
    setError(null);
    try {
      await bookingService.setBreakPlacement(assignmentId, minutes);
      setSaved(assignmentId);
      setTimeout(() => setSaved((s) => (s === assignmentId ? null : s)), 2000);
    } catch (err) {
      setError({ id: assignmentId, message: toFriendlyMessage(err) });
    }
  }

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
          <div key={a.id} className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--muted)]">{t.name}</span>
              <input
                type="time"
                className={inputCls}
                aria-label={`Break start, ${t.name}`}
                defaultValue={minutesToTimeInput(current)}
                onBlur={(e) => void save(a.id, e.target.value)}
              />
              {saved === a.id && <span className="text-xs text-[var(--teal)]">Saved</span>}
            </div>
            <ErrorNote message={error?.id === a.id ? error.message : null} />
          </div>
        );
      })}
    </div>
  );
}
