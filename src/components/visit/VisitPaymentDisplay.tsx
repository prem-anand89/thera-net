import { Pill } from '@/components/ui';
import { formatINR } from '@/domain/money';
import type { PaymentBadgeKind } from '@/domain/paymentState';
import { isPackageContinuation, paymentActions, paymentBadge } from '@/domain/paymentState';
import type { VisitCardData } from './types';

/**
 * Pill/button color per `paymentBadge()` kind (Billing & Notes Rebuild
 * Phase 1, D2) — re-keyed from the raw 6-state `VisitPaymentState` to the
 * 4-state display collapse, since "Due" and "Overdue" need visually
 * distinct tones and the raw state alone can't tell them apart (that's
 * `paymentBadge`'s job, using visitDate/issuedAt age). Label is computed
 * by `paymentBadge` itself, not stored here.
 */
export const PAYMENT_CHIP: Record<
  PaymentBadgeKind,
  { tone: 'green' | 'amber' | 'rust' | 'slate' }
> = {
  paid: { tone: 'green' },
  partial: { tone: 'amber' },
  due: { tone: 'amber' },
  overdue: { tone: 'rust' },
  none: { tone: 'slate' },
};

/**
 * Payment-status chip/action + invoiced lock marker — the table's status
 * cell (Bill is already its own column, so no amount here). Was also
 * nominally "shared" with the card's vertical stack per its old doc
 * comment, but confirmed that never actually happened — `SharedVisitCard`
 * has always had its own independent inline block; this function has
 * exactly one caller, `VisitTable`'s status cell.
 *
 * Billing & Notes Rebuild Phase 1, 1.1/1.2: the passive status Pill is
 * *replaced* by a filled `Collect ₹X` button whenever `take_payment` is
 * available — not shown alongside it. `issue_invoice` moved entirely into
 * `RowActionsMenu`'s kebab (see that component), so this no longer takes
 * an `onInvoice` prop; the non-`compact` rendering (dead — no caller ever
 * passed `compact={false}`) is gone along with the prop itself.
 */
export function PaymentStatusDisplay({
  data,
  onTakePayment,
  canInvoice,
}: {
  data: VisitCardData;
  onTakePayment?: () => void;
  canInvoice: boolean;
}) {
  const actions = canInvoice ? paymentActions(data.paymentState) : [];
  const badge = paymentBadge({
    state: data.paymentState,
    billPaise: data.billPaise,
    collectedPaise: data.collectedPaise,
    visitDate: data.visitDate,
    issuedAt: data.issuedAt,
    isPackageSession: isPackageContinuation(data.sessionIndex, data.packageTotal),
  });
  const showCollect = canInvoice && actions.includes('take_payment');

  // Billing fields freeze the moment a visit is invoiced (see
  // EditVisitModal's `frozen` check), independent of whether it's since
  // been collected — but only 'outstanding'/'partially_collected' chips
  // read ambiguously about that ("Due"/"Partial" say nothing about billing
  // being locked). 'paid' already says "Invoiced" in its own label.
  const billingLocked = Boolean(data.invoiceId) && data.paymentState !== 'paid';

  const hasSecondaryRow =
    (!canInvoice && paymentActions(data.paymentState).length > 0) || data.packageInvoicePending;

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-1">
        {billingLocked && (
          <span className="text-[10px]" title="Billing locked — this visit is invoiced">
            🔒
          </span>
        )}
        {showCollect ? (
          <button
            type="button"
            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium text-white hover:opacity-90 ${badge.kind === 'overdue' ? 'bg-[var(--rust)]' : 'bg-[var(--amber)]'}`}
            onClick={onTakePayment}
            title={badge.title}
          >
            Collect {formatINR(data.billPaise - data.collectedPaise)}
          </button>
        ) : (
          <Pill tone={PAYMENT_CHIP[badge.kind].tone}>
            <span className="whitespace-nowrap" title={badge.title}>
              {badge.label}
            </span>
          </Pill>
        )}
      </div>
      {hasSecondaryRow && (
        <div className="flex flex-wrap items-center gap-1">
          {!canInvoice && paymentActions(data.paymentState).length > 0 && (
            <Pill tone="slate">
              <span className="whitespace-nowrap">Ask billing</span>
            </Pill>
          )}
          {data.packageInvoicePending && (
            <Pill tone="amber">
              <span
                className="whitespace-nowrap"
                title="This session isn't on the package's invoice yet — amend the invoice to include it."
              >
                Not invoiced
              </span>
            </Pill>
          )}
        </div>
      )}
    </div>
  );
}
