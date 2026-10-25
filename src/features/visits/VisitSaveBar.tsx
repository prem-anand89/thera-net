import { formatINR } from '@/domain/money';
import { btnPrimary } from '@/components/ui';

export type SavePayment =
  | { kind: 'now'; methodLabel: string }
  | { kind: 'later' }
  | { kind: 'none' };

/**
 * "2 services · UPI, collected now" — the line under the total in both save bars. A visit that costs nothing
 * (a package session) says so instead of showing a payment that isn't happening.
 */
export function saveSummary(serviceCount: number, payment: SavePayment, totalPaise?: number): string {
  if (serviceCount === 0) return '';
  const details = [`${serviceCount} ${serviceCount === 1 ? 'service' : 'services'}`];
  if (totalPaise === 0) details.push('no charge');
  else if (payment.kind === 'now') details.push(`${payment.methodLabel}, collected now`);
  else if (payment.kind === 'later') details.push('to collect later');
  return details.join(' · ');
}

/**
 * Phone-only save bar, fixed flush to the bottom edge: the total and what happens to the money on the left
 * (so a Save that floats away from the Payment card can't record a payment nobody chose to collect; tap it to
 * jump to Payment), and Save. There is no Cancel here: the page's own header has the back arrow, and a Cancel
 * beside Save is one slip away from throwing the visit away. Hidden from `sm:` up, where the same summary and
 * buttons stick to the bottom of the form column.
 */
export function VisitSaveBar({
  totalPaise,
  serviceCount,
  payment,
  busy,
  onSave,
  onSummaryClick,
}: {
  totalPaise: number;
  serviceCount: number;
  payment: SavePayment;
  busy: boolean;
  onSave: () => void;
  onSummaryClick: () => void;
}) {
  const detailText = saveSummary(serviceCount, payment, totalPaise);

  return (
    <div
      data-testid="visit-save-bar"
      className="no-print fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-[max(1rem,env(safe-area-inset-left))] py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-2)] sm:hidden"
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onSummaryClick}
      >
        <span className="block truncate text-base font-semibold tabular-nums text-[var(--ink)]">
          {serviceCount === 0 ? 'No service yet' : formatINR(totalPaise)}
        </span>
        {serviceCount > 0 && (
          <span className="block truncate text-xs text-[var(--muted)]">{detailText}</span>
        )}
      </button>
      <button
        type="button"
        className={`${btnPrimary} h-11 shrink-0 whitespace-nowrap px-6`}
        disabled={busy || serviceCount === 0}
        onClick={onSave}
      >
        {busy ? 'Saving…' : 'Save visit'}
      </button>
    </div>
  );
}
