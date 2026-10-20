import { useEffect, useRef, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { clinicCountryCode } from '@/domain/clinicRegion';
import { COUNTRY_CODES, joinPhone, splitPhone } from '@/domain/countryCodes';
import { inputCls } from './ui';

/** The clinic's default code; +91 when there is no clinic context (public pages, isolated tests). */
function useClinicCountryCode(): string {
  try {
    // useClinic reads one context and throws outside a clinic: the hook runs on every render either way, so the order never changes.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return clinicCountryCode(useClinic());
  } catch {
    return clinicCountryCode(null);
  }
}

/**
 * A phone number with a small country-code picker ("+91 ▾", about 60px) in front of the number.
 * `value` and `onChange` use the stored form ("+91 9876543210"), so a caller keeps one string.
 * Existing numbers saved without a code read as the default country's.
 */
export function PhoneField({
  value,
  onChange,
  id,
  ariaLabel,
  autoFocus,
  disabled,
  placeholder,
  defaultCode: defaultCodeProp,
}: {
  value: string;
  onChange: (stored: string) => void;
  id?: string;
  /** Names the number input when no visible label points at `id`. */
  ariaLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** The code a number without one belongs to. Defaults to the clinic's own (+91 until it is set). */
  defaultCode?: string;
}) {
  const clinicCode = useClinicCountryCode();
  const defaultCode = defaultCodeProp ?? clinicCode;
  const initial = splitPhone(value, defaultCode);
  const [code, setCode] = useState(initial.code);
  const [national, setNational] = useState(initial.national);
  // The last string this field emitted, so only an outside change (a patient picked, a form reset) re-reads `value`.
  const emitted = useRef(value);
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const next = splitPhone(value, defaultCode);
    setCode(next.code);
    setNational(next.national);
  }, [value, defaultCode]);

  const emit = (nextCode: string, nextNational: string) => {
    const stored = joinPhone(nextCode, nextNational);
    emitted.current = stored;
    onChange(stored);
  };

  return (
    <div className="flex">
      <div className="relative flex shrink-0 items-center gap-1 rounded-l-lg border border-r-0 border-[var(--border)] bg-[var(--paper)] pl-2.5 pr-1.5 text-base font-medium tabular-nums text-[var(--ink)] sm:text-sm">
        <span aria-hidden>{code || '+'}</span>
        <span aria-hidden className="text-[10px] text-[var(--muted)]">▾</span>
        <select
          aria-label="Country code"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={code}
          disabled={disabled}
          onChange={(event) => {
            setCode(event.target.value);
            emit(event.target.value, national);
          }}
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.code || 'other'} value={c.code}>
              {c.flag} {c.name} {c.code}
            </option>
          ))}
        </select>
      </div>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder ?? (code === '+91' ? '98765 43210' : code ? 'Phone number' : '+ full number')}
        className={`${inputCls} min-w-0 flex-1 rounded-l-none tabular-nums`}
        value={national}
        onChange={(event) => {
          setNational(event.target.value);
          emit(code, event.target.value);
        }}
      />
    </div>
  );
}
