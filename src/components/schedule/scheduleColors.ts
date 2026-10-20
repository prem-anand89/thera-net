import type { Appointment } from '@/domain/types';
import { SERIES_COLORS } from '@/components/chartColors';

/** The app's validated categorical palette (`chartColors.ts`), assigned by
 *  a deterministic hash of the therapist's ID so colors never change on roster edits.
 *  If a therapist has explicitly chosen a color, that is used instead. */
export function therapistColor(id: string, color?: string | null): string {
  if (color) return color;
  
  // Deterministic hash so color remains stable across sessions
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SERIES_COLORS[Math.abs(hash) % SERIES_COLORS.length];
}

export const UNASSIGNED_COLOR = 'var(--slate)';

/** Diagonal hatch for closed days / time outside booking hours. */
export const CLOSED_HATCH_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(135deg, var(--slate-light) 0 6px, transparent 6px 12px)',
} as const;

export type AppointmentFillKind = 'upcoming' | 'arrived' | 'done' | 'no_show' | 'cancelled';

/**
 * The one status color code for appointments, shared by the Schedule grid
 * blocks and Workspace's Today rows: upcoming = white with the therapist's
 * edge; arrived (visit not logged yet) = tinted in the therapist's color;
 * visit logged = grey; no-show = rust; cancelled = grey, struck through.
 * Every status is also said in words (mark or pill), so color is never the
 * only signal.
 */
export function appointmentFill(appointment: Appointment, color: string): { kind: AppointmentFillKind; background: string } {
  // Any appointment with a linked visit is done, whatever its status says (the visit can
  // exist before the status catches up, e.g. mid-sync).
  if (appointment.visitId) return { kind: 'done', background: 'var(--slate-light)' };
  if (appointment.status === 'arrived') return { kind: 'arrived', background: `color-mix(in srgb, ${color} 18%, white)` };
  if (appointment.status === 'no_show') return { kind: 'no_show', background: 'var(--rust-light)' };
  if (appointment.status === 'cancelled') return { kind: 'cancelled', background: 'var(--slate-light)' };
  return { kind: 'upcoming', background: 'var(--surface)' };
}

/** The colors offered as swatches, in the app's fixed order (validated so neighbours stay apart under color-vision difference). */
export const THERAPIST_PALETTE: readonly string[] = SERIES_COLORS;

/** Plain-language names for the palette swatches, in the same order. */
export const THERAPIST_PALETTE_NAMES: readonly string[] = ['Blue', 'Orange', 'Aqua', 'Yellow', 'Pink', 'Green', 'Violet', 'Red'];

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

/** The first palette color nobody is using, so a new therapist never shares a color; with all taken, the least repeated. */
export function nextUnusedColor(taken: ReadonlyArray<string | null | undefined>): string {
  const used = taken.filter((c): c is string => Boolean(c));
  const free = THERAPIST_PALETTE.find((c) => !used.some((u) => same(u, c)));
  if (free) return free;
  const counts = THERAPIST_PALETTE.map((c) => used.filter((u) => same(u, c)).length);
  return THERAPIST_PALETTE[counts.indexOf(Math.min(...counts))];
}

type ColoredTherapist = { id: string; name: string; color?: string | null; active?: boolean };

/** Active therapists who show in the same color (their own choice or the default), grouped by color. */
export function colorClashes<T extends ColoredTherapist>(therapists: T[]): { color: string; therapists: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const t of therapists) {
    if (t.active === false) continue;
    const color = therapistColor(t.id, t.color).toLowerCase();
    groups.set(color, [...(groups.get(color) ?? []), t]);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([color, list]) => ({ color, therapists: [...list].sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Contrast ratio of a #rrggbb color against white (1 = invisible on white, 21 = black). */
export function contrastWithWhite(hex: string): number {
  const channel = (offset: number) => {
    const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05);
}

/** Below this the color barely shows on the white schedule (the palette's lightest swatch, yellow, is about 2.2). */
export const MIN_COLOR_CONTRAST = 1.8;

export function isReadableColor(hex: string): boolean {
  return isHexColor(hex) && contrastWithWhite(hex) >= MIN_COLOR_CONTRAST;
}
