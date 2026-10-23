import { formatINR } from '@/domain/money';
import { autoCredits, deliverer, type CreditShare } from '@/domain/visitLines';
import type { Therapist, UUID, VisitItem } from '@/domain/types';

export interface RevenueShareSummaryProps {
  items: VisitItem[];
  primaryId: UUID;
  billPaise: number;
  therapistsById: Map<UUID, Pick<Therapist, 'name'>>;
  /** The clinic's therapist-split setting; off hides the line (everything goes to the visit's therapist). */
  splitEnabled: boolean;
  /** Shares after a hand edit; omit to show the automatic ones. */
  credits?: CreditShare[];
  /** Reads "· edited" when the shares were changed by hand. */
  edited?: boolean;
  /** Opens the share editor. Without it the line has no "Edit split" link. */
  onEdit?: () => void;
}

/**
 * The quiet, read-only "who gets what" line under the bill. Shown only when someone other than the
 * visit's therapist is tagged on a service and the clinic splits revenue. Presentational.
 */
export function RevenueShareSummary({
  items,
  primaryId,
  billPaise,
  therapistsById,
  splitEnabled,
  credits,
  edited,
  onEdit,
}: RevenueShareSummaryProps) {
  const live = items.filter((i) => !i.deleted);
  if (!splitEnabled || !live.some((i) => i.assistingTherapistId)) return null;

  const shares = credits ?? autoCredits(items, primaryId, billPaise, { splitEnabled });
  const primaryLines = live.filter((i) => deliverer(i, primaryId) === primaryId);
  const packageNote =
    primaryLines.length === 1 && primaryLines[0].isPackageLine && primaryLines[0].pricePaise === 0;

  return (
    <div className="text-xs text-[var(--muted)]">
      <p>
        <span className="font-medium">Revenue share · {edited ? 'edited' : 'from services'}</span> —{' '}
        {shares
          .map((s) => {
            const pct = billPaise > 0 ? ` (${Math.round((s.amountPaise / billPaise) * 100)}%)` : '';
            return `${therapistsById.get(s.therapistId)?.name ?? 'Therapist'} ${formatINR(s.amountPaise)}${pct}`;
          })
          .join(' · ')}
        {onEdit && (
          <>
            {' '}
            <button
              type="button"
              className="font-medium text-[var(--teal)] hover:underline"
              onClick={onEdit}
            >
              Edit split
            </button>
          </>
        )}
      </p>
      {packageNote && <p className="mt-0.5">Package sessions are credited through package attribution.</p>}
    </div>
  );
}
