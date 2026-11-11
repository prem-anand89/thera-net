import type { ReactNode } from 'react';
import { formatAmount } from '@/domain/money';
import { Pill } from '@/components/ui';

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

/** Colour-coded Place badge (OP teal, Home sky, IP plum). */
export function VisitPlacePill({ label }: { label: string }) {
  const tone =
    label === 'Home' || label === 'Home visit'
      ? 'sky'
      : label === 'IP' || label === 'Inpatient'
        ? 'plum'
        : 'teal';
  return <Pill tone={tone}>{label}</Pill>;
}

/** The visit's services, one per line; a service with an assistant carries their initials as a chip.
 *  With `max`, the rest collapse into "+N more" (the full list is in the title).
 *  Optional `trailing` renders inline on the last visible row (e.g. a care location pill). Read-only. */
export function VisitServicesList({
  services,
  max,
  trailing,
}: {
  services: VisitServiceDetailsData['services'];
  max?: number;
  trailing?: ReactNode;
}) {
  const shown = max && services.length > max ? services.slice(0, max) : services;
  const hidden = services.length - shown.length;
  return (
    <ul title={hidden > 0 ? services.map((s) => s.name).join(', ') : undefined}>
      {shown.map((s, i) => (
        <li key={`${s.name}-${i}`} className="flex flex-wrap items-center gap-1.5">
          <span>
            {s.name}
            {s.assistantName && (
              <span
                className="ml-1 rounded bg-[var(--surface-2,rgba(0,0,0,0.06))] px-1 text-[10px] font-medium text-[var(--muted)]"
                title={`${s.assistantName} assisting`}
              >
                {initials(s.assistantName)}
              </span>
            )}
          </span>
          {i === shown.length - 1 && hidden === 0 && trailing && (
            <span className="shrink-0">{trailing}</span>
          )}
        </li>
      ))}
      {hidden > 0 && (
        <li className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
          <span>+{hidden} more</span>
          {trailing && <span className="shrink-0">{trailing}</span>}
        </li>
      )}
    </ul>
  );
}

/** "Revenue share — Dr R ₹867 · Dr S ₹433", shown when a visit's bill is shared. Read-only. */
export function VisitSharesLine({ shares }: { shares: NonNullable<VisitServiceDetailsData['shares']> }) {
  return (
    <p className="text-xs text-[var(--muted)]">
      <span className="font-medium">Revenue share</span> —{' '}
      {shares.map((s) => `${s.name} ${formatAmount(s.amountPaise)}`).join(' · ')}
    </p>
  );
}
