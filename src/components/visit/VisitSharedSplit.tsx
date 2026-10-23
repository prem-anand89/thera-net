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
export function IconSplit({ pct, className, size = 12 }: { pct: number; className?: string; size?: number }) {
  const r = 4.5;
  const circumference = 2 * Math.PI * r;
  const shared = (Math.min(Math.max(pct, 0), 100) / 100) * circumference;
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className={className} overflow="visible">
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

/** Assistants' names for the ring: one assistant in full when it fits, else "First L."; several by first name. */
export function assistantNamesShort(names: string[], maxChars = 14): string {
  const first = (n: string) => n.replace(/^dr\.?\s+/i, '').trim().split(/\s+/)[0] ?? n;
  if (names.length === 1) {
    const n = names[0]!.trim();
    if (n.length <= maxChars) return n;
    const parts = n.replace(/^dr\.?\s+/i, '').trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.` : n;
  }
  return names.map(first).join(', ');
}

/** The ring for a visit whose bill is shared by several therapists (share rows): the rust arc is everything
 *  that goes to someone other than the primary therapist, and hovering shows each therapist's rupee share.
 *  With `onEdit` it is a button that opens the split editor; `edited` marks a split set by hand. */
export function SharesRing({
  shares,
  primaryName,
  onEdit,
  edited,
  services,
}: {
  shares: { name: string; amountPaise: number }[];
  primaryName: string;
  onEdit?: () => void;
  edited?: boolean;
  /** The visit's services, to say which assistant did what when the split follows them. */
  services?: { name: string; assistantName: string | null }[];
}) {
  const total = shares.reduce((sum, s) => sum + s.amountPaise, 0);
  if (total <= 0) return null;
  const primary = shares.find((s) => s.name === primaryName)?.amountPaise ?? 0;
  const pct = Math.round(((total - primary) / total) * 100);
  const line = shares.map((s) => `${s.name} ₹${Math.round(s.amountPaise / 100).toLocaleString('en-IN')}`).join(' · ');
  const tagged = (services ?? [])
    .filter((x) => x.assistantName)
    .map((x) => `${x.assistantName}: ${x.name}`)
    .join('; ');
  const why = edited
    ? 'Set by hand (not following services)'
    : tagged
      ? `Split from services — ${tagged}`
      : 'Split from services';
  const title = `${why}\nRevenue share — ${line}${onEdit ? '\nClick to edit.' : ''}`;
  const others = assistantNamesShort(
    shares.filter((s) => s.name !== primaryName && s.amountPaise > 0).map((s) => s.name)
  );
  const label = `Revenue share: ${pct}% to others`;
  const body = (
    <>
      <IconSplit pct={pct} size={18} className="shrink-0" />
      <span className="font-medium">{pct}%</span>
      {others && <span className="max-w-[9rem] truncate">· {others}</span>}
    </>
  );
  const cls = 'inline-flex items-center gap-1.5 py-0.5 text-xs leading-tight';
  if (onEdit) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className={`${cls} -mx-1 rounded-md px-1 no-underline transition-colors hover:bg-[rgba(198,95,47,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1`}
        style={{ color: RING_RUST }}
        title={title}
        aria-label={`${label}. Edit split`}
      >
        {body}
      </button>
    );
  }
  return (
    <span className={cls} style={{ color: RING_RUST }} title={title} aria-label={label}>
      {body}
    </span>
  );
}
