import { useEffect, useId, useRef, useState } from 'react';
import type { PaymentMethod } from '@/domain/types';

export interface PaymentMethodOption {
  value: PaymentMethod;
  label: string;
}

export interface PaymentMethodChipsProps {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  options: PaymentMethodOption[];
  disabled?: boolean;
}

const PRIMARY_KEYS: PaymentMethod[] = ['upi', 'cash', 'card'];

/**
 * Fast one-tap radio chips for common payment methods (UPI, Cash, Card)
 * plus an "Other ▾" expandable chip for remaining methods (e.g. Partner, Bank transfer).
 * Arrow-key navigable with role="radiogroup" and accessible 44px tap targets.
 */
export function PaymentMethodChips({
  value,
  onChange,
  options,
  disabled = false,
}: PaymentMethodChipsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const otherButtonRef = useRef<HTMLButtonElement>(null);
  const groupId = useId();

  const primaryOptions = options.filter((opt) => PRIMARY_KEYS.includes(opt.value));
  const otherOptions = options.filter((opt) => !PRIMARY_KEYS.includes(opt.value));

  const selectedOther = otherOptions.find((opt) => opt.value === value);
  const isOtherSelected = Boolean(selectedOther);

  const otherLabel = selectedOther ? selectedOther.label : 'Other';

  // Close dropdown on click outside or Escape
  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        otherButtonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  // Combined radio items for arrow navigation: primary items followed by "other" (if otherOptions exist)
  type RadioItem =
    | { kind: 'primary'; value: PaymentMethod; label: string }
    | { kind: 'other'; value: PaymentMethod; label: string };

  const radioItems: RadioItem[] = [
    ...primaryOptions.map((opt) => ({ kind: 'primary' as const, value: opt.value, label: opt.label })),
    ...(otherOptions.length > 0
      ? [
          {
            kind: 'other' as const,
            value: isOtherSelected ? value : otherOptions[0].value,
            label: otherLabel,
          },
        ]
      : []),
  ];

  const activeIndex = isOtherSelected
    ? radioItems.findIndex((it) => it.kind === 'other')
    : radioItems.findIndex((it) => it.value === value);

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (disabled) return;
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (index + 1) % radioItems.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (index - 1 + radioItems.length) % radioItems.length;
    }

    if (nextIndex !== null) {
      const targetItem = radioItems[nextIndex];
      // Arrowing onto "Other" focuses it without picking one of its methods.
      if (targetItem.kind === 'primary' || isOtherSelected) onChange(targetItem.value);
      setMenuOpen(false);
      // Focus the new radio item
      const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      buttons?.[nextIndex]?.focus();
    }
  }

  const baseChip =
    'min-h-11 flex-1 min-w-[72px] sm:min-w-0 px-3 py-2 text-sm font-medium rounded-lg border transition-colors flex items-center justify-center text-center disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label="Payment method"
      className="relative flex flex-wrap items-center gap-2"
    >
      {primaryOptions.map((opt, i) => {
        const isSelected = value === opt.value;
        return (
          <button
            key={opt.value}
            id={`${groupId}-${opt.value}`}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected || (activeIndex === -1 && i === 0) ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              onChange(opt.value);
              setMenuOpen(false);
            }}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={`${baseChip} ${
              isSelected
                ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}

      {otherOptions.length > 0 && (
        <div className="relative flex-1 min-w-[100px] sm:min-w-0">
          <button
            ref={otherButtonRef}
            id={`${groupId}-other`}
            type="button"
            role="radio"
            aria-checked={isOtherSelected}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            tabIndex={isOtherSelected ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              // Opening the menu never changes the method; only picking an item does.
              setMenuOpen((prev) => !prev);
            }}
            onKeyDown={(e) => {
              const otherIndex = radioItems.findIndex((it) => it.kind === 'other');
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setMenuOpen((prev) => !prev);
              } else {
                handleKeyDown(e, otherIndex);
              }
            }}
            className={`w-full ${baseChip} ${
              isOtherSelected
                ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]'
            }`}
          >
            <span className="truncate">{otherLabel}</span>
            <span aria-hidden="true" className="ml-1 shrink-0 text-xs">
              ▾
            </span>
          </button>

          {menuOpen && (
            <div
              role="menu"
              aria-label="Additional payment methods"
              className="absolute left-0 right-0 sm:left-auto sm:right-0 top-full mt-1.5 z-30 min-w-[200px] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg"
            >
              {otherOptions.map((opt) => {
                const isItemActive = value === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitem"
                    className={`min-h-11 flex w-full items-center justify-between px-3 py-2 text-left text-sm rounded-md transition-colors ${
                      isItemActive
                        ? 'bg-[var(--teal-light)] text-[var(--teal)] font-medium'
                        : 'text-[var(--ink)] hover:bg-[var(--paper)]'
                    }`}
                    onClick={() => {
                      onChange(opt.value);
                      setMenuOpen(false);
                      otherButtonRef.current?.focus();
                    }}
                  >
                    <span className="truncate">{opt.label}</span>
                    {isItemActive && (
                      <span className="ml-2 shrink-0 text-xs text-[var(--teal)]">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
