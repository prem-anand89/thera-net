import { formatINR } from '@/domain/money';
import {
  computeAdjustedBillPaise,
  describeBillAdjustment,
  type BillAdjustmentMode,
  type BillAdjustmentValueType,
} from '@/domain/billAdjustment';
import { Field, inputCls } from '@/components/ui';

function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md border border-[var(--border)] p-0.5 text-sm">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={opt.disabled}
          onClick={() => onChange(opt.value)}
          className={`flex-1 rounded px-2 py-1.5 text-center text-xs font-medium transition-colors ${
            value === opt.value
              ? 'bg-[var(--teal-light)] text-[var(--teal)]'
              : 'text-[var(--muted)] hover:bg-[var(--paper)]'
          } ${opt.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

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
}

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
}: BillAdjustmentFieldsProps) {
  const numericValue = Number(value);
  const adjustment = {
    mode,
    valueType,
    value: Number.isFinite(numericValue) ? numericValue : 0,
  };
  const billPaise = computeAdjustedBillPaise(catalogPricePaise, adjustment);
  const summary = describeBillAdjustment(catalogPricePaise, billPaise);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--paper)] px-3 py-2.5 text-sm">
        <span className="text-[var(--muted)]">{catalogLabel ?? 'Catalog price'}: </span>
        <span className="font-medium text-[var(--ink)]">{formatINR(catalogPricePaise)}</span>
      </div>

      <Field label="Adjustment">
        <SegmentedToggle
          value={mode}
          onChange={onModeChange}
          options={[
            { value: 'none', label: 'None' },
            {
              value: 'discount',
              label: 'Discount',
              disabled: continuationSession && catalogPricePaise === 0,
            },
            { value: 'extra', label: 'Extra' },
          ]}
        />
      </Field>

      {mode !== 'none' && (
        <>
          <Field label={mode === 'discount' ? 'Discount by' : 'Extra by'}>
            <SegmentedToggle
              value={valueType}
              onChange={onValueTypeChange}
              options={[
                { value: 'amount', label: 'Amount (₹)' },
                { value: 'percent', label: 'Percent (%)' },
              ]}
            />
          </Field>
          <Field label={valueType === 'amount' ? 'Amount' : 'Percent'}>
            <input
              type="number"
              min={0}
              max={valueType === 'percent' && mode === 'discount' ? 100 : undefined}
              step={valueType === 'amount' ? '0.01' : '1'}
              className={inputCls}
              placeholder={valueType === 'amount' ? 'e.g. 200' : 'e.g. 10'}
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
            />
          </Field>
        </>
      )}

      <div className="rounded-lg border border-[var(--teal)] bg-[var(--teal-light)] px-3 py-2.5 text-sm text-[var(--teal-strong)]">
        <span className="font-medium">Final bill: {formatINR(billPaise)}</span>
        {summary && (
          <span className="mt-0.5 block text-xs text-[var(--teal-strong)]/90">
            {summary.kind === 'discount' ? 'Discount' : 'Extra'} of{' '}
            {formatINR(summary.amountPaise)}
            {valueType === 'percent' && numericValue > 0 ? ` (${numericValue}%)` : ''}
          </span>
        )}
      </div>

      {summary && (
        <Field
          label={`Reason * (${summary.kind === 'discount' ? 'discount' : 'extra'} of ${formatINR(summary.amountPaise)})`}
        >
          <input
            className={inputCls}
            placeholder={
              summary.kind === 'discount'
                ? 'e.g. loyalty discount, staff concession'
                : 'e.g. added session, weekend surcharge'
            }
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
          />
        </Field>
      )}
    </div>
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
