import { Link } from '@tanstack/react-router';
import { Pill } from '@/components/ui';
import { formatINR } from '@/domain/money';
import { formatDateDM } from '@/domain/fiscalYear';
import type { UUID } from '@/domain/types';
import type { AssistedVisit } from './assistedVisits';

/** What the assistant's own share line reads: their amount, or that the revenue isn't shared. */
export function assistedShareText(sharePaise: number | null, assistantName?: string): string {
  if (sharePaise == null) return 'revenue not shared';
  return `${assistantName ? `${assistantName}'s` : 'Your'} share ${formatINR(sharePaise)}`;
}

/**
 * Visits the viewer assisted on, as read-only rows. Deliberately no bill, payment status, Collect,
 * invoice or edit actions: those belong to the visit's primary therapist.
 */
export function AssistedVisitList({
  rows,
  patientName,
  showDate = true,
  assistantName,
  viewerIsAssistant,
}: {
  rows: AssistedVisit[];
  patientName: (patientId: UUID) => string;
  showDate?: boolean;
  /** The assisting therapist the rows belong to. */
  assistantName: string;
  /** True when the signed-in user is that therapist ("Your share"); otherwise the rows name them. */
  viewerIsAssistant: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className="divide-y divide-[var(--border)]" aria-label={viewerIsAssistant ? 'Visits you assisted on' : 'Visits assisted on'}>
      {rows.map((r) => (
        <li key={r.visitId} className="space-y-1 py-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              to="/patients/$patientId"
              params={{ patientId: r.patientId }}
              className="text-sm font-medium text-[var(--ink)] hover:underline"
            >
              {patientName(r.patientId)}
            </Link>
            <Pill tone="slate">Assisted</Pill>
            <span className="text-xs text-[var(--muted)]">with {r.primaryName}</span>
            {showDate && <span className="text-xs text-[var(--muted)]">{formatDateDM(r.visitDate)}</span>}
          </div>
          <div className="text-xs text-[var(--ink)]">{r.services.join(', ')}</div>
          <div className="text-xs font-medium text-[var(--ink)]">{assistedShareText(r.sharePaise, viewerIsAssistant ? undefined : assistantName)}</div>
          <div className="text-xs text-[var(--muted)]">
            {viewerIsAssistant && 'Not on your schedule. '}Logged on {r.primaryName}&apos;s visit.
          </div>
        </li>
      ))}
    </ul>
  );
}
