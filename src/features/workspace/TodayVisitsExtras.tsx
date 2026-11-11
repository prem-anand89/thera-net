import { chipSelect, chipSelectChevron } from '@/components/ui';
import { formatAmount } from '@/domain/money';
import type { TodayTotals } from './todayTotals';

/** "All therapists | Asha (3) | Ravi (2)": narrows Today's visits to one therapist's day. */
export function TodayTherapistFilter({
  options,
  value,
  onChange,
}: {
  options: { id: string; name: string; count: number }[];
  /** A therapist id, or '' for everyone. */
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <select
      aria-label="Therapist"
      className={chipSelect}
      style={chipSelectChevron}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All therapists</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name} ({o.count})
        </option>
      ))}
    </select>
  );
}

/**
 * Sums the visits the card is showing (all of them, not just the page on screen): billed, paid, due
 * (or stay/logged totals in IP). Count lives in the card header badge, so Visits N & generic "Total"
 * labels are omitted to avoid duplication.
 */
export function TodayVisitsTotals({
  totals,
  label,
  showMoney,
  inpatientBillingMode,
}: {
  totals: TodayTotals;
  label?: string;
  showMoney: boolean;
  inpatientBillingMode?: 'stay_bill' | 'partner_billed' | null;
}) {
  const displayLabel = label && label !== 'Total' && label !== 'Today' ? label : undefined;
  if (!showMoney && !displayLabel) return null;

  const cell = (name: string, value: string, tone?: string) => (
    <span className="whitespace-nowrap">
      <span className="text-[var(--muted)]">{name}</span> <span className={`font-num font-semibold ${tone ?? 'text-[var(--ink)]'}`}>{value}</span>
    </span>
  );
  return (
    <div
      role="group"
      aria-label="Totals for the visits shown"
      className={`flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[var(--border)] bg-[var(--paper)] px-3 py-2.5 text-xs ${
        displayLabel ? 'justify-between' : 'justify-end'
      }`}
    >
      {displayLabel && <span className="font-medium text-[var(--ink)]">{displayLabel}</span>}
      {showMoney && (
        <span className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1">
          {inpatientBillingMode === 'partner_billed' ? (
            cell('Logged', formatAmount(totals.billedPaise))
          ) : inpatientBillingMode === 'stay_bill' ? (
            cell('IP Bill', formatAmount(totals.billedPaise), 'text-[var(--teal)]')
          ) : (
            <>
              {cell('Billed', formatAmount(totals.billedPaise))}
              {cell('Paid', formatAmount(totals.paidPaise), 'text-[var(--teal)]')}
              {cell('Due', formatAmount(totals.duePaise), totals.duePaise > 0 ? 'text-[var(--rust)]' : undefined)}
            </>
          )}
        </span>
      )}
    </div>
  );
}
