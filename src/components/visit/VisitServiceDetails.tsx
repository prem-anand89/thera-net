import { formatINR } from '@/domain/money';

export interface VisitServiceDetailsData {
  services: { name: string; assistantName: string | null }[];
  shares: { name: string; amountPaise: number }[] | null;
}

/** True when there is more to show than the single service name already on the row. */
export function hasServiceDetails(d: VisitServiceDetailsData | undefined): d is VisitServiceDetailsData {
  return Boolean(d && (d.services.length > 1 || d.services.some((s) => s.assistantName) || d.shares));
}

/** The visit's services, one per line, with "· Dr X assisting" tags. Read-only. */
export function VisitServicesList({ services }: { services: VisitServiceDetailsData['services'] }) {
  return (
    <ul>
      {services.map((s, i) => (
        <li key={`${s.name}-${i}`}>
          {s.name}
          {s.assistantName && <span className="text-[var(--muted)]"> · {s.assistantName} assisting</span>}
        </li>
      ))}
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
