import { formatINR } from '@/domain/money';
import { btnPrimary } from '@/components/ui';
import { PHONE_BOTTOM_NAV } from '@/components/schedule/gridShared';

export type SavePayment =
  | { kind: 'now'; methodLabel: string }
  | { kind: 'later' }
  | { kind: 'none' };

/**
 * Phone-only save bar, fixed just above the app's bottom navigation. It spells out the payment choice so
 * a Save that floats away from the Payment card can't record a payment nobody chose to collect. Tapping
 * the summary jumps to the Payment card. Hidden from `sm:` up, where Save sits under the Payment card.
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
  const parts = [formatINR(totalPaise), `${serviceCount} ${serviceCount === 1 ? 'service' : 'services'}`];
  if (payment.kind === 'now') parts.push(`${payment.methodLabel}, collected now`);
  if (payment.kind === 'later') parts.push('to collect later');
  return (
    <div
      data-testid="visit-save-bar"
      className="no-print fixed inset-x-0 z-20 flex items-center gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-[max(1rem,env(safe-area-inset-left))] py-2 shadow-[var(--shadow-2)] sm:hidden"
      style={{ bottom: `calc(${PHONE_BOTTOM_NAV}px + env(safe-area-inset-bottom))` }}
    >
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[var(--ink)]"
        onClick={onSummaryClick}
      >
        {parts.join(' · ')}
      </button>
      <button type="button" className={`${btnPrimary} shrink-0`} disabled={busy} onClick={onSave}>
        {busy ? 'Saving…' : 'Save visit'}
      </button>
    </div>
  );
}
