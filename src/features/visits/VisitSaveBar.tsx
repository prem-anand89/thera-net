import { formatINR } from '@/domain/money';
import { btnPrimary, btnSecondary } from '@/components/ui';

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
 * The save bar, fixed flush to the bottom edge at every width (not a floating card over the form): the total and
 * what happens to the money on the left (so a Save that is nowhere near the Payment card can't record a payment
 * nobody chose to collect; tap it to jump to Payment), and Save. Cancel appears from `sm:` up only: on a phone the
 * page's own header has the back arrow, and a Cancel beside Save is one slip away from throwing the visit away.
 * Its content lines up with the form above (same max width).
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
  /** Shown from `sm:` up. */
  onCancel: () => void;
  onSummaryClick: () => void;
}) {
  const detailText = saveSummary(serviceCount, payment, totalPaise);

  return (
    <div
      data-testid="visit-save-bar"
      className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border)] bg-[var(--surface)] px-[max(1rem,env(safe-area-inset-left))] py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-2)]"
    >
      <div className="mx-auto flex max-w-5xl items-center gap-3">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onSummaryClick}
      >
        <span className={`block truncate text-base font-semibold text-[var(--ink)] ${serviceCount > 0 ? 'font-num' : ''}`}>
          {serviceCount === 0 ? 'No service yet' : formatINR(totalPaise)}
        </span>
        {serviceCount > 0 && (
          <span className="block truncate text-xs text-[var(--muted)]">{detailText}</span>
        )}
      </button>
      <button
        type="button"
        className={`${btnSecondary} hidden h-11 shrink-0 sm:inline-flex sm:items-center`}
        disabled={busy}
        onClick={onCancel}
      >
        Cancel
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
    </div>
  );
}
