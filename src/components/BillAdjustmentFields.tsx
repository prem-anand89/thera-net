import { useEffect, useState } from 'react';
import { formatINR } from '@/domain/money';
import {
  computeAdjustedBillPaise,
  describeBillAdjustment,
  type BillAdjustmentMode,
  type BillAdjustmentValueType,
} from '@/domain/billAdjustment';

export interface BillAdjustmentFieldsProps {
  catalogPricePaise: number;
  catalogLabel?: string;
  mode: BillAdjustmentMode;
  valueType: BillAdjustmentValueType;
  /** Rupees string when valueType is amount; percent string when percent */
  value: string;
  reason: string;
  onModeChange: (mode: BillAdjustmentMode) => void;
  onValueTypeChange: (type: BillAdjustmentValueType) => void;
  onValueChange: (value: string) => void;
  onReasonChange: (reason: string) => void;
  /** When true (package continuation), only extra adjustments are offered */
  continuationSession?: boolean;
  /** Label for the teal result box; the New Visit form calls it "Total". */
  totalLabel?: string;
  /** New Visit: with nothing adjusted the Total says the same as the price box, so show the price box only once it differs. */
  hideUnadjustedPrice?: boolean;
  /** Greys out every control (New Visit while the subtotal is ₹0). */
  disabled?: boolean;
  /**
   * New Visit: the save bar already shows the total, so with no discount or extra the green total box would
   * only repeat it. It appears once there is an adjustment to explain.
   */
  hideTotalWhenPlain?: boolean;
  /**
   * When true (e.g. New Visit where all invoice amounts and totals live in the Payment card footer),
   * suppresses the standalone price and total boxes.
   */
  hideSummaryBoxes?: boolean;
}

const PERCENT_PRESETS = ['10', '15', '20'];
const REASON_PRESETS = ['Loyalty', 'Package / Bulk', 'Staff / Family'] as const;

export function BillAdjustmentFields({
  catalogPricePaise,
  catalogLabel,
  mode,
  valueType,
  value,
  reason,
  onModeChange,
  onValueTypeChange,
  onValueChange,
  onReasonChange,
  continuationSession,
  totalLabel = 'Final bill',
  hideUnadjustedPrice = false,
  hideTotalWhenPlain = false,
  hideSummaryBoxes = false,
  disabled,
}: BillAdjustmentFieldsProps) {
  const numericValue = Number(value);
  const adjustment = {
    mode,
    valueType,
    value: Number.isFinite(numericValue) ? numericValue : 0,
  };
  const billPaise = computeAdjustedBillPaise(catalogPricePaise, adjustment);
  const summary = describeBillAdjustment(catalogPricePaise, billPaise);

  const hasAdjustment = mode !== 'none';
  const [expanded, setExpanded] = useState(hasAdjustment);

  const isPresetReason = (REASON_PRESETS as readonly string[]).includes(reason);
  const [customReasonActive, setCustomReasonActive] = useState(Boolean(reason && !isPresetReason));

  useEffect(() => {
    if (hasAdjustment) {
      setExpanded(true);
    }
  }, [hasAdjustment]);

  useEffect(() => {
    if (reason && !isPresetReason) {
      setCustomReasonActive(true);
    }
  }, [reason, isPresetReason]);

  function handleRemove() {
    setExpanded(false);
    setCustomReasonActive(false);
    onModeChange('none');
    onValueChange('');
    onReasonChange('');
  }

  const effectiveType = mode === 'extra' ? 'extra' : 'discount';

  return (
    <fieldset disabled={disabled} className="m-0 min-w-0 space-y-3 border-0 p-0">
      {!hideSummaryBoxes && (hasAdjustment || !hideUnadjustedPrice) && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--paper)] px-3 py-2 text-xs">
          <span className="text-[var(--muted)]">{catalogLabel ?? 'Catalog price'}: </span>
          <span className="font-num font-medium text-[var(--ink)]">{formatINR(catalogPricePaise)}</span>
        </div>
      )}

      {!expanded && !hasAdjustment ? (
        <div>
          <button
            type="button"
            disabled={disabled || (continuationSession && catalogPricePaise === 0)}
            onClick={() => setExpanded(true)}
            className="inline-flex h-8 items-center text-xs font-medium text-[var(--teal)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            + Discount / Extra
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--paper)] p-2.5 space-y-2.5 shadow-2xs">
          {/* Main Controls Row: Type Toggle + Joined Pill [ ₹ | % | 10 ] + % Presets + Remove */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Left: Type Toggle (Discount vs Extra) */}
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 text-xs font-medium shrink-0">
              <button
                type="button"
                disabled={continuationSession && catalogPricePaise === 0}
                onClick={() => onModeChange('discount')}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  mode === 'discount'
                    ? 'bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                } ${continuationSession && catalogPricePaise === 0 ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                Discount
              </button>
              <button
                type="button"
                onClick={() => onModeChange('extra')}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  mode === 'extra'
                    ? 'bg-[var(--amber-light)] font-semibold text-[var(--amber)]'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                Extra
              </button>
            </div>

            {/* Fused Joined Pill: [ ₹ | % | 10 ] */}
            <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 shadow-2xs focus-within:border-[var(--teal)] shrink-0">
              <button
                type="button"
                onClick={() => onValueTypeChange('amount')}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  valueType === 'amount'
                    ? 'bg-[var(--ink)] font-semibold text-white'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
                title="Amount in Rupees"
              >
                ₹
              </button>
              <button
                type="button"
                onClick={() => onValueTypeChange('percent')}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  valueType === 'percent'
                    ? 'bg-[var(--ink)] font-semibold text-white'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
                title="Percentage"
              >
                %
              </button>
              <div className="mx-1 h-3.5 w-px bg-[var(--border)] shrink-0" />
              <input
                type="number"
                min={0}
                max={valueType === 'percent' && effectiveType === 'discount' ? 100 : undefined}
                step={valueType === 'amount' ? '0.01' : '1'}
                value={value}
                onChange={(e) => {
                  if (mode === 'none') {
                    onModeChange('discount');
                  }
                  onValueChange(e.target.value);
                }}
                placeholder="0"
                className="w-16 bg-transparent px-1.5 py-0.5 text-right text-xs font-num text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none tabular-nums"
              />
            </div>

            {/* Fast 1-Tap % Presets */}
            <div className="flex items-center gap-1 shrink-0">
              {PERCENT_PRESETS.map((pct) => {
                const isActive = valueType === 'percent' && value === pct && mode !== 'none';
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      if (mode === 'none') {
                        onModeChange('discount');
                      }
                      onValueTypeChange('percent');
                      onValueChange(pct);
                    }}
                    className={`rounded-md border px-2 py-1 text-[11px] font-medium font-num transition-colors shadow-2xs ${
                      isActive
                        ? 'border-[var(--teal)] bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                        : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--paper)]'
                    }`}
                  >
                    {pct}%
                  </button>
                );
              })}
            </div>

            {/* Right: Remove / Reset to None (no duplicate preview math inside box) */}
            <button
              type="button"
              onClick={handleRemove}
              title="Remove adjustment"
              aria-label="Remove adjustment"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)] transition-colors text-xs font-semibold"
            >
              ✕
            </button>
          </div>

          {/* Reason Row: 1-Tap Quick-Pick Chips + Compact Inline Input */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[var(--border)]/60">
            <span className="text-[11px] font-medium text-[var(--muted)] mr-1 shrink-0">
              Reason{summary ? ' *' : ''}:
            </span>
            {REASON_PRESETS.map((preset) => {
              const isSelected = reason === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setCustomReasonActive(false);
                    onReasonChange(isSelected ? '' : preset);
                  }}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors shadow-2xs ${
                    isSelected
                      ? 'border-[var(--teal)] bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--paper)]'
                  }`}
                >
                  {isSelected ? '✓ ' : ''}{preset}
                </button>
              );
            })}
            {!customReasonActive && !isPresetReason && reason ? (
              <button
                type="button"
                onClick={() => setCustomReasonActive(true)}
                className="rounded-full border border-[var(--teal)] bg-[var(--teal-light)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--teal-strong)] shadow-2xs"
              >
                ✓ {reason}
              </button>
            ) : !customReasonActive ? (
              <button
                type="button"
                onClick={() => setCustomReasonActive(true)}
                className="rounded-full border border-dashed border-[var(--border)] bg-[var(--surface)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--muted)] hover:border-[var(--teal)] hover:text-[var(--ink)] transition-colors shadow-2xs"
              >
                + Other...
              </button>
            ) : null}

            {customReasonActive && (
              <div className="inline-flex items-center gap-1 flex-1 min-w-[10rem]">
                <input
                  autoFocus
                  className="w-full sm:max-w-xs rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--teal)] focus:outline-none"
                  placeholder={
                    effectiveType === 'discount'
                      ? 'e.g. senior citizen concession, loyalty discount'
                      : 'e.g. weekend surcharge, extended session'
                  }
                  value={reason}
                  onChange={(e) => onReasonChange(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!isPresetReason && reason) onReasonChange('');
                    setCustomReasonActive(false);
                  }}
                  className="text-[var(--muted)] hover:text-[var(--ink)] text-xs px-1"
                  title="Cancel custom reason"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Standalone Total Callout for views like EditVisitModal where hideSummaryBoxes is false */}
      {!hideSummaryBoxes && (
        <div
          className={`rounded-lg border border-[var(--teal)] bg-[var(--teal-light)] px-3 py-2.5 text-sm text-[var(--teal-strong)] ${
            hideTotalWhenPlain && !summary ? 'hidden' : ''
          }`}
        >
          <span className="font-num font-medium">
            {totalLabel}: {formatINR(billPaise)}
          </span>
          {summary && (
            <span className="mt-0.5 block text-xs text-[var(--teal-strong)]/90">
              {summary.kind === 'discount' ? 'Discount' : 'Extra'} of {formatINR(summary.amountPaise)}
              {valueType === 'percent' && numericValue > 0 ? ` (${numericValue}%)` : ''}
            </span>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** Parse field state into a bill adjustment input for computeAdjustedBillPaise. */
export function billAdjustmentFromFields(
  mode: BillAdjustmentMode,
  valueType: BillAdjustmentValueType,
  value: string
) {
  const numericValue = Number(value);
  return {
    mode,
    valueType,
    value: Number.isFinite(numericValue) ? numericValue : 0,
  };
}
