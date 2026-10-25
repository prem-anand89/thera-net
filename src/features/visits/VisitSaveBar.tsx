import { formatINR } from '@/domain/money';
import { btnPrimary } from '@/components/ui';

export type SavePayment =
  | { kind: 'now'; methodLabel: string }
  | { kind: 'later' }
  | { kind: 'none' };

/** "2 services · UPI, collected now" — the line under the total in both save bars. */
export function saveSummary(serviceCount: number, payment: SavePayment): string {
  if (serviceCount === 0) return '';
  const details = [`${serviceCount} ${serviceCount === 1 ? 'service' : 'services'}`];
  if (payment.kind === 'now') details.push(`${payment.methodLabel}, collected now`);
  if (payment.kind === 'later') details.push('to collect later');
  return details.join(' · ');
}

/**
 * Phone-only save bar, fixed flush to the bottom edge. It spells out the payment choice so
 * a Save that floats away from the Payment card can't record a payment nobody chose to collect. Tapping
 * the summary jumps to the Payment card. Hidden from `sm:` up, where the same summary and buttons stick to the bottom of the form column.
 */
export function VisitSaveBar({
  totalPaise,
  serviceCount,
  payment,
  busy,
  onSave,
  onCancel,
  onSummaryClick,
}: {
  totalPaise: number;
  serviceCount: number;
  payment: SavePayment;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  onSummaryClick: () => void;
}) {
  const detailText = saveSummary(serviceCount, payment);

  return (
    <div
      data-testid="visit-save-bar"
      className="no-print fixed inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-[max(1rem,env(safe-area-inset-left))] py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-2)] sm:hidden"
    >
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left"
        onClick={onSummaryClick}
      >
        <span className="block truncate text-base font-semibold tabular-nums text-[var(--ink)]">
          {serviceCount === 0 ? 'No service yet' : formatINR(totalPaise)}
        </span>
        {serviceCount > 0 && (
          <span className="block truncate text-xs text-[var(--muted)]">
            {detailText}
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          className="min-h-11 rounded-lg px-3 text-sm font-medium text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)] disabled:opacity-40 transition-colors"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${btnPrimary} whitespace-nowrap`}
          disabled={busy || serviceCount === 0}
          onClick={onSave}
        >
          {busy ? 'Saving…' : 'Save visit'}
        </button>
      </div>
    </div>
  );
}
