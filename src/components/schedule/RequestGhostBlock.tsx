import { useEffect, useRef, useState } from 'react';
import { blockGeometry, minutesLabel } from '@/domain/schedule';
import type { UUID } from '@/domain/types';

/** A pending public booking request drawn on the grid at the time the patient asked for. */
export type RequestGhost = {
  id: UUID;
  name: string;
  date: string;
  /** Minutes after midnight. */
  minutes: number;
  /** The column it belongs to (the requested therapist, or the clinic's only one). */
  therapistId: string;
  /** Brought into view and ringed (the sidebar card was tapped). */
  highlight?: boolean;
  onConfirm: () => void;
  onDecline: () => void;
};

/**
 * A quiet dashed marker for a booking request, not an appointment: it takes no time, blocks nothing and can't be
 * dragged. Tap it for Confirm / Decline. When an appointment already sits at that time it shrinks to a small tab on
 * the column's right edge so neither one covers the other.
 */
export function RequestGhostBlock({
  ghost,
  hoursStart,
  pxPerMinute,
  overlapsAppointment,
}: {
  ghost: RequestGhost;
  hoursStart: number;
  pxPerMinute: number;
  overlapsAppointment: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { top } = blockGeometry(ghost.minutes, 30, hoursStart, pxPerMinute);

  useEffect(() => {
    if (ghost.highlight) rootRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [ghost.highlight]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = `${ghost.name} · ${minutesLabel(ghost.minutes)}`;
  return (
    <div
      ref={rootRef}
      className={`absolute right-0.5 z-[5] ${overlapsAppointment ? 'w-14' : 'w-[calc(100%-4px)] max-w-[11rem]'}`}
      style={{ top: top + 1 }}
      data-request-ghost
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Booking request from ${ghost.name} for ${minutesLabel(ghost.minutes)}`}
        title={label}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-6 w-full items-center gap-1 truncate rounded-md border border-dashed border-[var(--amber)] bg-[var(--amber-light)] px-1.5 text-left text-[11px] font-medium text-[var(--amber)] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--amber)] ${
          ghost.highlight ? 'ring-2 ring-[var(--amber)]' : ''
        }`}
      >
        <span className="truncate">{overlapsAppointment ? 'Req' : `${ghost.name}?`}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`Request from ${ghost.name}`}
          className="absolute right-0 top-7 z-10 w-48 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-xs shadow-lg"
        >
          <p className="font-medium text-[var(--ink)]">{ghost.name}</p>
          <p className="text-[var(--muted)]">Asked for {minutesLabel(ghost.minutes)}</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="min-h-8 flex-1 rounded-lg bg-[var(--teal)] px-2 text-xs font-medium text-white"
              onClick={() => {
                setOpen(false);
                ghost.onConfirm();
              }}
            >
              Confirm
            </button>
            <button
              type="button"
              className="min-h-8 px-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--rust)]"
              onClick={() => {
                setOpen(false);
                ghost.onDecline();
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
