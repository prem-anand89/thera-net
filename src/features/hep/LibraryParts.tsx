// Small pieces the Library grid, table and picker share: the picture (or tile), the type tag and the one-line facts.
import { EXERCISE_PHASE_LABELS, EXERCISE_TYPE_TONE, HEP_BODY_ORDER, alsoPhasesOf, canonicalRegion, positionsOf, type Exercise, type ExercisePhase } from '@/domain/hep';
import { regionLabel } from '@/domain/hepLibrary';

/** The CSS colour of a type's tone. */
export const toneVar = (phase: ExercisePhase) => `var(--${EXERCISE_TYPE_TONE[phase]})`;

/** A region's own soft tint for tiles without a picture: the fixed regions take the tones in turn. */
const TINTS = ['sky', 'plum', 'amber', 'rust', 'moss', 'teal'] as const;
export function regionTint(region: string): string {
  const key = canonicalRegion(region).startsWith('Pelvic floor') ? 'Pelvic floor' : canonicalRegion(region);
  const i = (HEP_BODY_ORDER as readonly string[]).indexOf(key);
  const tone = i === -1 ? 'slate' : TINTS[i % TINTS.length];
  return `color-mix(in srgb, var(--${tone}) 14%, var(--paper))`;
}

export function TypeTag({ phase, alsoPhases }: { phase: ExercisePhase; alsoPhases?: ExercisePhase[] }) {
  const extra = alsoPhasesOf({ phase, alsoPhases });
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: toneVar(phase) }} />
        {EXERCISE_PHASE_LABELS[phase]}
      </span>
      {extra.map((p) => (
        <span key={p} className="inline-flex items-center gap-1 whitespace-nowrap text-[var(--muted)]">
          <span aria-hidden="true">·</span>
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: toneVar(p) }} />
          {EXERCISE_PHASE_LABELS[p]}
        </span>
      ))}
    </span>
  );
}

/** "Knee · Supine, Sitting · Towel" (parts that are empty are left out). */
export function exerciseFacts(ex: Exercise): string {
  const equipment = ex.equipment.filter((e) => e && e !== 'None').join(', ');
  return [regionLabel(canonicalRegion(ex.bodyRegion)), positionsOf(ex).join(', '), equipment].filter(Boolean).join(' · ');
}

/** The picture (not when the exercise hides its pictures in lists), or a tinted tile. `ratio` is a Tailwind aspect class; `size` a fixed square. */
export function Thumb({ ex, url, size, ratio }: { ex: Exercise; url: string | undefined; size?: number; ratio?: string }) {
  const hidden = !!ex.hidePicturesInLists;
  const box = size ? { width: size, height: size } : undefined;
  const cls = `relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg ${ratio ?? ''} ${size ? '' : 'w-full'}`;
  if (url && !hidden) {
    return (
      <span className={`${cls} border border-[var(--border)]/60 bg-[var(--surface)] ${size ? 'p-0.5' : 'p-1'}`} style={box}>
        <img src={url} alt="" loading="lazy" className="h-full w-full object-contain" />
        {ex.mediaType === 'gif' && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">GIF</span>}
      </span>
    );
  }
  return (
    <span className={`${cls} text-[var(--muted)]`} style={{ ...box, background: regionTint(ex.bodyRegion) }} aria-hidden="true">
      <span className="text-base leading-none">📄</span>
    </span>
  );
}
