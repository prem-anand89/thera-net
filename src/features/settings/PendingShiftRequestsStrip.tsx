import { useRef, useState } from 'react';
import { bookingService } from '@/services';
import { ErrorNote, inputCls } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import {
  formatRange12h,
  formatWeekdays,
  minutesToTimeInput,
} from './shiftUtils';
import type {
  ShiftTemplate,
  Therapist,
  TherapistShiftAssignment,
  WorkingHours,
} from '@/domain/types';

function summarizePending(
  assignment: TherapistShiftAssignment,
  templateById: Map<string, ShiftTemplate>
): string {
  if (assignment.shiftTemplateId) {
    const t = templateById.get(assignment.shiftTemplateId);
    const days = assignment.weekdays ? formatWeekdays(assignment.weekdays) : '';
    const hours = t ? ` (${formatRange12h(t.startMinute, t.endMinute)})` : '';
    return `${t?.name ?? 'Shift'}${hours} · ${days}`;
  }
  if (assignment.customHours === null) {
    return 'Reset to clinic default hours';
  }
  const parts: string[] = [];
  const wh = assignment.customHours as WorkingHours;
  for (let day = 0; day < 7; day++) {
    const intervals = wh[String(day) as keyof WorkingHours];
    if (!intervals) continue;
    const ranges =
      intervals.length === 0
        ? 'off'
        : intervals
            .map(([s, e]) => `${minutesToTimeInput(s)}–${minutesToTimeInput(e)}`)
            .join(' & ');
    parts.push(`${formatWeekdays([day])}: ${ranges}`);
  }
  return `Custom hours — ${parts.join(', ')}`;
}

export function PendingShiftRequestsStrip({
  requests,
  therapists,
  templates,
}: {
  requests: TherapistShiftAssignment[];
  therapists: Therapist[];
  templates: ShiftTemplate[];
}) {
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const decidingRef = useRef(false);
  const [declineOpenId, setDeclineOpenId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (requests.length === 0) return null;

  const therapistById = new Map(therapists.map((t) => [t.id, t]));
  const templateById = new Map(templates.map((t) => [t.id, t]));

  async function handleApprove(requestId: string) {
    if (decidingRef.current) return;
    decidingRef.current = true;
    setDecidingId(requestId);
    setError(null);
    try {
      await bookingService.approveShiftAssignment(requestId);
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      decidingRef.current = false;
      setDecidingId(null);
    }
  }

  async function handleDecline(requestId: string) {
    if (decidingRef.current) return;
    decidingRef.current = true;
    setDecidingId(requestId);
    setError(null);
    try {
      await bookingService.declineShiftAssignment(
        requestId,
        declineReason.trim() || null
      );
      setDeclineOpenId(null);
      setDeclineReason('');
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      decidingRef.current = false;
      setDecidingId(null);
    }
  }

  return (
    <div
      className="rounded-2xl border border-[var(--amber)] bg-[var(--amber-light)]/40 p-4 space-y-3"
      data-testid="pending-requests-strip"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--ink)] flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-[var(--amber)]" />
          Pending shift requests ({requests.length})
        </h3>
      </div>

      <div className="space-y-2">
        {requests.map((req) => {
          const therapist = therapistById.get(req.therapistId);
          const name = therapist?.name ?? 'Therapist';
          const summary = summarizePending(req, templateById);
          const isDeciding = decidingId === req.id;
          const isDeclineOpen = declineOpenId === req.id;

          return (
            <div
              key={req.id}
              className="flex flex-col gap-2 rounded-xl bg-[var(--surface)] p-3 border border-[var(--border)] sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-[var(--ink)]">
                  <strong>{name}</strong> requests {summary}
                </p>
                {req.note && (
                  <p className="text-xs text-[var(--muted)]">Note: &ldquo;{req.note}&rdquo;</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isDeclineOpen ? (
                  <div className="flex items-center gap-2">
                    <input
                      className={`${inputCls} !py-1 text-xs max-w-48`}
                      placeholder="Decline reason (optional)"
                      aria-label={`Decline reason for ${name}`}
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      disabled={isDeciding}
                    />
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center rounded-lg bg-[var(--rust)] px-3 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                      disabled={isDeciding}
                      onClick={() => void handleDecline(req.id)}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="text-xs text-[var(--muted)] hover:text-[var(--ink)]"
                      onClick={() => {
                        setDeclineOpenId(null);
                        setDeclineReason('');
                      }}
                      disabled={isDeciding}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center rounded-lg bg-[var(--teal)] px-3 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                      disabled={isDeciding}
                      onClick={() => void handleApprove(req.id)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--rust)] hover:bg-[var(--paper)] disabled:opacity-50"
                      disabled={isDeciding}
                      onClick={() => {
                        setDeclineOpenId(req.id);
                        setDeclineReason('');
                      }}
                    >
                      Decline…
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <ErrorNote message={error} />
    </div>
  );
}
