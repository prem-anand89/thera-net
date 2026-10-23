import { formatINR } from '@/domain/money';

export interface VisitServiceDetailsData {
  services: { name: string; assistantName: string | null }[];
  shares: { name: string; amountPaise: number }[] | null;
  hasShareRows?: boolean;
}

/** True when there is more to show than the single service name already on the row. */
export function hasServiceDetails(d: VisitServiceDetailsData | undefined): d is VisitServiceDetailsData {
  return Boolean(d && (d.services.length > 1 || d.services.some((s) => s.assistantName) || d.shares));
}

function initials(name: string): string {
  const parts = name.replace(/^dr\.?\s+/i, '').split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

/** The visit's services, one per line; a service with an assistant carries their initials as a chip.
 *  With `max`, the rest collapse into "+N more" (the full list is in the title). Read-only. */
export function VisitServicesList({
  services,
  max,
}: {
  services: VisitServiceDetailsData['services'];
  max?: number;
}) {
  const shown = max && services.length > max ? services.slice(0, max) : services;
  const hidden = services.length - shown.length;
  return (
    <ul title={hidden > 0 ? services.map((s) => s.name).join(', ') : undefined}>
      {shown.map((s, i) => (
        <li key={`${s.name}-${i}`}>
          {s.name}
          {s.assistantName && (
            <span
              className="ml-1 rounded bg-[var(--surface-2,rgba(0,0,0,0.06))] px-1 text-[10px] font-medium text-[var(--muted)]"
              title={`${s.assistantName} assisting`}
            >
              {initials(s.assistantName)}
            </span>
          )}
        </li>
      ))}
      {hidden > 0 && <li className="text-xs text-[var(--muted)]">+{hidden} more</li>}
    </ul>
  );
}

/** "Revenue share — Dr R ₹867 · Dr S ₹433", shown when a visit's bill is shared. Read-only. */
export function VisitSharesLine({ shares }: { shares: NonNullable<VisitServiceDetailsData['shares']> }) {
  return (
    <p className="text-xs text-[var(--muted)]">
      <span className="font-medium">Revenue share</span> —{' '}
      {shares.map((s) => `${s.name} ${formatINR(s.amountPaise)}`).join(' · ')}
    </p>
  );
}
