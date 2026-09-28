/** Subtly brighter variants of the app's --teal/--rust tokens, same hues
 *  (184°/19°) with only a modest lightness/saturation bump, used only by
 *  the split-percentage ring below. At the ring's 12px size the standard
 *  tokens (tuned for larger fills — buttons, pills) read as slightly
 *  murky; a small step up keeps the ring legibly the same teal shown on
 *  TherapistPill (not a lighter, more turquoise color) while still
 *  standing out from the paper background. Every other teal/rust use in
 *  the app keeps the standard, darker tokens unchanged. */
const RING_TEAL = '#31777d';
const RING_RUST = '#c65f2f';

/** Percentage ring for the shared-split line under a therapist's name —
 *  the rust arc's length is the visit's actual split share (not just a
 *  two-color hint), traced over a teal track standing for the rest, so
 *  the icon itself carries real information rather than only decorating
 *  the "N% → colleague" text next to it. */
export function IconSplit({ pct, className }: { pct: number; className?: string }) {
  const r = 4.5;
  const circumference = 2 * Math.PI * r;
  const shared = (Math.min(Math.max(pct, 0), 100) / 100) * circumference;
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={className}>
      <circle cx="6" cy="6" r={r} fill="none" stroke={RING_TEAL} strokeWidth="2.4" />
      <circle
        cx="6"
        cy="6"
        r={r}
        fill="none"
        stroke={RING_RUST}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray={`${shared} ${circumference - shared}`}
        transform="rotate(-90 6 6)"
      />
    </svg>
  );
}

/** Compact "N% → colleague" line shown under a therapist's name when a
 *  visit's revenue is split — stacked below rather than beside the name
 *  pill so a long colleague name can't widen the row/column; wraps within
 *  its own line if it must instead. Matches the ring's rust arc,
 *  distinguishing it at a glance from the plain grey metadata (dates,
 *  session counts) elsewhere in the same card. */
export function SharedSplitLine({ pct, name }: { pct: number; name: string }) {
  return (
    <span
      className="inline-flex max-w-[9rem] items-center gap-1 text-[11px] leading-tight"
      style={{ color: RING_RUST }}
    >
      <IconSplit pct={pct} className="shrink-0" />
      <span className="truncate" title={`${pct}% → ${name}`}>
        {pct}% → {name}
      </span>
    </span>
  );
}
