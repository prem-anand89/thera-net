import type { Appointment } from '@/domain/types';
import { SERIES_COLORS } from '@/components/chartColors';

/** The app's validated categorical palette (`chartColors.ts`), assigned by
 *  roster order. Past 8 therapists the hues repeat; the column header name
 *  stays the real identifier. */
export function therapistColor(index: number): string {
  return SERIES_COLORS[((index % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length];
}

export const UNASSIGNED_COLOR = 'var(--slate)';

/** Diagonal hatch for closed days / time outside booking hours. */
export const CLOSED_HATCH_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(135deg, var(--slate-light) 0 6px, transparent 6px 12px)',
} as const;

export type AppointmentFillKind = 'upcoming' | 'arrived' | 'done' | 'no_show' | 'cancelled';

/**
 * The one status colour code for appointments, shared by the Schedule grid
 * blocks and Workspace's Today rows: upcoming = white with the therapist's
 * edge; arrived (visit not logged yet) = tinted in the therapist's colour;
 * visit logged = grey; no-show = rust; cancelled = grey, struck through.
 * Every status is also said in words (mark or pill), so colour is never the
 * only signal.
 */
export function appointmentFill(appointment: Appointment, color: string): { kind: AppointmentFillKind; background: string } {
  if (appointment.status === 'arrived' && appointment.visitId) return { kind: 'done', background: 'var(--slate-light)' };
  if (appointment.status === 'arrived') return { kind: 'arrived', background: `color-mix(in srgb, ${color} 18%, white)` };
  if (appointment.status === 'no_show') return { kind: 'no_show', background: 'var(--rust-light)' };
  if (appointment.status === 'cancelled') return { kind: 'cancelled', background: 'var(--slate-light)' };
  return { kind: 'upcoming', background: 'var(--surface)' };
}
