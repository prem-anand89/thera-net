import type { PatientFlag } from '@/domain/patientFlags';
import { PatientFlagPills } from './PatientFlagPills';

const clock = (minutes: number) => `${Math.floor(minutes / 60) % 12 || 12}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Appointment card content for the single-column phone Day (wide blocks, about
 * 275px). Lines by block height, so nothing is ever clipped mid-line:
 * under ~28px one line ("10:00 Name"); to ~52px two lines (name + time,
 * then the reason, or the first flags when there is no reason); taller, three
 * lines (name + time, reason, flags).
 */
export function WideBlock({
  name,
  start,
  end,
  reason,
  flags,
  height,
  mark,
}: {
  name: string;
  /** Minutes after midnight. */
  start: number;
  end: number;
  reason: string | null;
  flags: PatientFlag[];
  /** Block height in px. */
  height: number;
  /** Status mark shown before the name (e.g. "✓" for arrived). */
  mark?: string;
}) {
  const range = `${clock(start)}–${clock(end)}`;
  if (height < 28) {
    return (
      <span className="block truncate text-xs">
        {mark && <span aria-hidden>{mark} </span>}
        <span className="tabular-nums text-[var(--muted)]">{clock(start)}</span> {name}
      </span>
    );
  }
  const threeLines = height >= 52;
  const flagsOnLine2 = !reason && flags.length > 0;
  return (
    <>
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-display text-[13px] font-semibold leading-tight">
          {mark && <span aria-hidden>{mark} </span>}
          {name}
        </span>
        <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--muted)]">{range}</span>
      </span>
      {reason && <span className="mt-px block truncate text-[11px] italic text-[var(--muted)]">{reason}</span>}
      {flagsOnLine2 && <span className="mt-px block truncate"><PatientFlagPills flags={flags} max={2} /></span>}
      {threeLines && reason && flags.length > 0 && (
        <span className="mt-0.5 block truncate">
          <PatientFlagPills flags={flags} max={2} />
        </span>
      )}
    </>
  );
}
