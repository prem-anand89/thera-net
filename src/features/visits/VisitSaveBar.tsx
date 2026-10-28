import { useState, useRef, useEffect } from 'react';
import { formatINR } from '@/domain/money';
import { btnPrimary, btnSecondary } from '@/components/ui';

export type SavePayment =
  | { kind: 'now'; method?: string; methodLabel: string }
  | { kind: 'later' }
  | { kind: 'none' };

/**
 * "2 services · UPI, collected now" — fallback line under the total. A visit that costs nothing
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

export function VisitSaveBar({
  totalPaise,
  serviceCount,
  payment,
  busy,
  onSave,
  onCancel,
  onSummaryClick,
  subtext,
  onQuickChangePayment,
}: {
  totalPaise: number;
  serviceCount: number;
  payment: SavePayment;
  busy: boolean;
  onSave: () => void;
  /** Shown from `sm:` up. */
  onCancel: () => void;
  onSummaryClick: () => void;
  /** Optional rich itemized breakdown (e.g. "2 services (Manual ₹1,500 + Advanced ₹2,000) · Craniosacral") */
  subtext?: string;
  /** Quick-switch payment method directly from popover without scrolling */
  onQuickChangePayment?: (mode: 'upi' | 'cash' | 'card' | 'later') => void;
}) {
  const [paymentMenuOpen, setPaymentMenuOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const fallbackDetailText = saveSummary(serviceCount, payment, totalPaise);
  const displayText = subtext || fallbackDetailText;

  // Close popover when clicking outside or pressing Escape
  useEffect(() => {
    if (!paymentMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPaymentMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPaymentMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [paymentMenuOpen]);

  const isFree = totalPaise === 0;

  return (
    <div
      data-testid="visit-save-bar"
      className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border)] bg-[var(--surface)]/95 px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur-md sm:bottom-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[calc(100%-2rem)] sm:max-w-4xl sm:rounded-2xl sm:border sm:border-[var(--border)] sm:shadow-[0_8px_30px_rgba(0,0,0,0.08)] sm:px-5 sm:py-3 sm:pb-3"
    >
      <div className="flex items-center justify-between gap-4">
        {/* LEFT: Total + Interactive Quick-Popover Payment Pill + Itemized Breakdown */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <button
              type="button"
              className="text-left focus-visible:outline-none"
              onClick={onSummaryClick}
            >
              <span
                className={`text-lg sm:text-xl font-bold tracking-tight text-[var(--ink)] hover:text-[var(--teal)] transition-colors ${
                  serviceCount > 0 ? 'font-num' : ''
                }`}
              >
                {serviceCount === 0 ? 'No service yet' : formatINR(totalPaise)}
              </span>
            </button>

            {/* Interactive Payment Status Pill */}
            {serviceCount > 0 && (
              <div className="relative inline-block" ref={popoverRef}>
                <button
                  type="button"
                  data-testid="payment-quick-pill"
                  disabled={isFree}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isFree && onQuickChangePayment) {
                      setPaymentMenuOpen((open) => !open);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all ${
                    isFree
                      ? 'border border-[var(--teal)]/30 bg-[var(--teal-light)] text-[var(--teal-strong)]'
                      : payment.kind === 'later'
                        ? 'border border-[var(--amber)]/30 bg-[var(--amber-light)] text-[var(--amber)] hover:bg-[var(--amber-light)]/80'
                        : 'border border-[var(--teal)]/30 bg-[var(--teal-light)] text-[var(--teal-strong)] hover:bg-[var(--teal-light)]/80'
                  } ${!isFree && onQuickChangePayment ? 'cursor-pointer' : 'cursor-default'}`}
                  title={!isFree && onQuickChangePayment ? 'Click to quick-switch payment method' : undefined}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isFree
                        ? 'bg-[var(--teal)]'
                        : payment.kind === 'later'
                          ? 'bg-[var(--amber)]'
                          : 'bg-[var(--teal)]'
                    }`}
                  />
                  <span>
                    {isFree
                      ? '📦 Package session'
                      : payment.kind === 'later'
                        ? 'Take payment later'
                        : payment.kind === 'now'
                          ? `${payment.methodLabel} · Collected now`
                          : ''}
                  </span>
                  {!isFree && onQuickChangePayment && (
                    <span className="text-[10px] opacity-70" aria-hidden="true">▾</span>
                  )}
                </button>

                {/* Instant Popover Menu above the pill */}
                {paymentMenuOpen && onQuickChangePayment && (
                  <div
                    data-testid="payment-popover"
                    className="absolute bottom-full left-0 mb-2 w-52 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      Quick switch payment
                    </div>
                    {(
                      [
                        { key: 'upi', label: 'UPI (Collect now)' },
                        { key: 'cash', label: 'Cash (Collect now)' },
                        { key: 'card', label: 'Card (Collect now)' },
                        { key: 'later', label: 'Take payment later' },
                      ] as const
                    ).map((item) => {
                      const isCurrent =
                        item.key === 'later'
                          ? payment.kind === 'later'
                          : payment.kind === 'now' &&
                            (payment.method === item.key || payment.methodLabel.toLowerCase().includes(item.key));
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            onQuickChangePayment(item.key);
                            setPaymentMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                            isCurrent
                              ? 'bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                              : 'text-[var(--ink)] hover:bg-[var(--paper)]'
                          }`}
                        >
                          <span>{item.label}</span>
                          {isCurrent && <span className="text-xs">✓</span>}
                        </button>
                      );
                    })}
                    <div className="mt-1 border-t border-[var(--border)] pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentMenuOpen(false);
                          onSummaryClick();
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--teal)] hover:bg-[var(--paper)]"
                      >
                        <span>More payment options</span>
                        <span aria-hidden="true">↗</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Subtext: Itemized breakdown or select service guidance */}
          <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
            {serviceCount === 0 ? (
              <span>Select a service to save visit</span>
            ) : (
              <span title={displayText}>{displayText}</span>
            )}
          </div>
        </div>

        {/* RIGHT: Cancel & Primary Save Action */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            className={`${btnSecondary} hidden h-10 rounded-xl px-4 text-xs font-semibold text-[var(--ink)] sm:inline-flex sm:items-center hover:bg-[var(--paper)]`}
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            aria-label={busy ? 'Saving…' : 'Save visit'}
            className={`${btnPrimary} flex h-10 shrink-0 items-center gap-2 rounded-xl whitespace-nowrap px-5 text-xs font-semibold shadow-xs hover:shadow-md transition-all`}
            disabled={busy || serviceCount === 0}
            onClick={onSave}
          >
            <span>{busy ? 'Saving…' : 'Save visit'}</span>
            {!busy && serviceCount > 0 && (
              <kbd
                aria-hidden="true"
                className="hidden sm:inline-flex items-center rounded border border-white/20 bg-white/15 px-1.5 py-0.5 text-[10px] font-mono leading-none text-white/90"
              >
                ⌘↵
              </kbd>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
