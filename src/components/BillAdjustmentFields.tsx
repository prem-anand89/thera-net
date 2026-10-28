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
  /** True when the visit includes a multi-session package in the cart */
  hasPackageInCart?: boolean;
}

const DISCOUNT_PERCENT_PRESETS = [5, 10, 15, 20];
const DISCOUNT_AMOUNT_PRESETS = [100, 200, 500];
const EXTRA_AMOUNT_PRESETS = [150, 300, 500];
const EXTRA_PERCENT_PRESETS = [5, 10, 15, 20];

const DISCOUNT_REASONS = ['Package / Bulk', 'Loyalty', 'Staff / Family', 'Courtesy'] as const;
const EXTRA_REASONS = ['Consumables / Tape', 'Home Visit', 'Extended Session', 'Equipment'] as const;

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
  hasPackageInCart = false,
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

  const isPresetReason = (
    [...DISCOUNT_REASONS, ...EXTRA_REASONS] as readonly string[]
  ).includes(reason);
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

  const effectiveType: 'discount' | 'extra' = mode === 'extra' ? 'extra' : 'discount';
  const activeReasons = effectiveType === 'extra' ? EXTRA_REASONS : DISCOUNT_REASONS;

  function handleModeSwitch(newMode: 'discount' | 'extra') {
    onModeChange(newMode);
    if (newMode === 'extra') {
      if (valueType === 'percent' && (!value || value === '10' || value === '5' || value === '15' || value === '20')) {
        onValueTypeChange('amount');
        onValueChange('200');
      }
      if (!reason || (DISCOUNT_REASONS as readonly string[]).includes(reason)) {
        onReasonChange('Consumables / Tape');
      }
    } else {
      if (valueType === 'amount' && (!value || value === '200' || value === '150' || value === '300')) {
        onValueTypeChange('percent');
        onValueChange('10');
      }
      if (!reason || (EXTRA_REASONS as readonly string[]).includes(reason)) {
        onReasonChange(hasPackageInCart ? 'Package / Bulk' : 'Loyalty');
      }
    }
  }

  // Smart round-off preset when subtotal has an odd rupee remainder
  const subtotalRupees = Math.floor(catalogPricePaise / 100);
  const remainder500 = subtotalRupees % 500;
  let roundOffPreset: { value: number; label: string; type: BillAdjustmentValueType } | null = null;
  if (
    effectiveType === 'discount' &&
    valueType === 'amount' &&
    remainder500 > 0 &&
    subtotalRupees >= 500 &&
    !DISCOUNT_AMOUNT_PRESETS.includes(remainder500)
  ) {
    const target = subtotalRupees - remainder500;
    roundOffPreset = {
      value: remainder500,
      label: `Round to ₹${target.toLocaleString('en-IN')}`,
      type: 'amount',
    };
  }

  // Active presets based on mode and unit
  const activePresets: Array<{ value: number; label: string; type: BillAdjustmentValueType }> =
    effectiveType === 'extra'
      ? valueType === 'amount'
        ? EXTRA_AMOUNT_PRESETS.map((p) => ({ value: p, label: `+₹${p}`, type: 'amount' as const }))
        : EXTRA_PERCENT_PRESETS.map((p) => ({ value: p, label: `+${p}%`, type: 'percent' as const }))
      : valueType === 'percent'
        ? DISCOUNT_PERCENT_PRESETS.map((p) => ({ value: p, label: `${p}%`, type: 'percent' as const }))
        : [
          ...DISCOUNT_AMOUNT_PRESETS.map((p) => ({ value: p, label: `₹${p}`, type: 'amount' as const })),
          ...(roundOffPreset ? [roundOffPreset] : []),
        ];

  // Live computed deduction badge
  const liveDeltaPaise =
    valueType === 'percent' && numericValue > 0 && catalogPricePaise > 0
      ? Math.round((catalogPricePaise * numericValue) / 100)
      : 0;

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
        <div className="relative rounded-xl border border-[var(--border)] bg-[var(--paper)] p-2.5 pr-9 sm:pr-9 space-y-2.5 shadow-2xs">
          {/* ROW 1: Mode Switch + Fused Input [ 10 | % | ₹ ] + Smart Presets + Live Delta + Close Button */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Mode Toggle (Discount vs Extra) */}
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 text-xs font-medium shrink-0">
              <button
                type="button"
                disabled={continuationSession && catalogPricePaise === 0}
                onClick={() => handleModeSwitch('discount')}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${effectiveType === 'discount'
                    ? 'bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                  } ${continuationSession && catalogPricePaise === 0 ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                Discount
              </button>
              <button
                type="button"
                onClick={() => handleModeSwitch('extra')}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${effectiveType === 'extra'
                    ? 'bg-[var(--amber-light)] font-semibold text-[var(--amber)]'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                  }`}
              >
                Extra
              </button>
            </div>

            {/* Fused Compact Input + Unit Switcher [ 10 | % | ₹ ] */}
            <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 shadow-2xs focus-within:border-[var(--teal)] shrink-0 overflow-hidden">
              <input
                type="text"
                inputMode="numeric"
                value={value}
                onChange={(e) => {
                  const sanitized = e.target.value.replace(/[^0-9.]/g, '');
                  if (mode === 'none') {
                    onModeChange(effectiveType);
                    if (!reason) {
                      onReasonChange(
                        effectiveType === 'extra'
                          ? 'Consumables / Tape'
                          : hasPackageInCart
                            ? 'Package / Bulk'
                            : 'Loyalty'
                      );
                    }
                  }
                  onValueChange(sanitized);
                }}
                placeholder="0"
                className="w-12 bg-transparent px-1.5 py-0.5 text-center text-xs font-bold font-num text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none tabular-nums"
              />
              <div className="flex items-center h-full bg-[var(--paper)] border-l border-[var(--border)] p-0.5 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    if (mode === 'none') {
                      onModeChange(effectiveType);
                      if (!reason) {
                        onReasonChange(
                          effectiveType === 'extra'
                            ? 'Consumables / Tape'
                            : hasPackageInCart
                              ? 'Package / Bulk'
                              : 'Loyalty'
                        );
                      }
                    }
                    onValueTypeChange('percent');
                  }}
                  className={`rounded px-1.5 py-0.5 transition-colors ${valueType === 'percent'
                      ? 'bg-[var(--teal-strong)] font-semibold text-white shadow-2xs'
                      : 'text-[var(--muted)] hover:text-[var(--ink)]'
                    }`}
                  title="Percentage"
                >
                  %
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (mode === 'none') {
                      onModeChange(effectiveType);
                      if (!reason) {
                        onReasonChange(
                          effectiveType === 'extra'
                            ? 'Consumables / Tape'
                            : hasPackageInCart
                              ? 'Package / Bulk'
                              : 'Loyalty'
                        );
                      }
                    }
                    onValueTypeChange('amount');
                  }}
                  className={`rounded px-1.5 py-0.5 transition-colors ${valueType === 'amount'
                      ? 'bg-[var(--teal-strong)] font-semibold text-white shadow-2xs'
                      : 'text-[var(--muted)] hover:text-[var(--ink)]'
                    }`}
                  title="Amount in Rupees"
                >
                  ₹
                </button>
              </div>
            </div>

            {/* Smart 1-Tap Preset Pills (Context-Aware Pill Geometry) */}
            <div className="flex flex-wrap items-center gap-1 shrink-0">
              {activePresets.map((preset) => {
                const isSelected =
                  valueType === preset.type &&
                  numericValue === preset.value &&
                  mode !== 'none';
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      if (mode === 'none') {
                        onModeChange(effectiveType);
                        if (!reason) {
                          onReasonChange(
                            effectiveType === 'extra'
                              ? 'Consumables / Tape'
                              : hasPackageInCart
                                ? 'Package / Bulk'
                                : 'Loyalty'
                          );
                        }
                      }
                      onValueTypeChange(preset.type);
                      onValueChange(String(preset.value));
                    }}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium font-num transition-colors shadow-2xs tabular-nums ${isSelected
                        ? 'border-[var(--teal)] bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                        : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--paper)]'
                      }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Live Computed Delta Badge (Instant feedback when % is selected) */}
            {liveDeltaPaise > 0 && (
              <span
                className={`font-num text-xs font-semibold tabular-nums ml-0.5 shrink-0 ${effectiveType === 'extra' ? 'text-[var(--amber)]' : 'text-[var(--teal-strong)]'
                  }`}
              >
                {effectiveType === 'extra' ? '+' : '−'}
                {formatINR(liveDeltaPaise)}
              </span>
            )}

            {/* Remove / Close Button - Anchored top-right corner on mobile and desktop */}
            <button
              type="button"
              onClick={handleRemove}
              title="Remove adjustment"
              aria-label="Remove adjustment"
              className="absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)] transition-colors text-xs font-semibold shrink-0"
            >
              ✕
            </button>
          </div>

          {/* ROW 2: Context-Aware Reason Chips (Matching Pill Geometry) */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[var(--border)]/60">
            <span className="text-[11px] font-medium text-[var(--muted)] mr-1 shrink-0">
              Reason{summary || mode !== 'none' ? ' *' : ''}:
            </span>
            {activeReasons.map((preset) => {
              const isSelected = !customReasonActive && reason === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setCustomReasonActive(false);
                    if (mode === 'none') {
                      onModeChange(effectiveType);
                    }
                    onReasonChange(isSelected ? '' : preset);
                  }}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors shadow-2xs ${isSelected
                      ? 'border-[var(--teal)] bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--paper)]'
                    }`}
                >
                  {isSelected ? '✓ ' : ''}
                  {preset}
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
          className={`rounded-lg border border-[var(--teal)] bg-[var(--teal-light)] px-3 py-2.5 text-sm text-[var(--teal-strong)] ${hideTotalWhenPlain && !summary ? 'hidden' : ''
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
