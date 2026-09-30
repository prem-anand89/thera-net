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
