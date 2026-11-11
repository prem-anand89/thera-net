/**
 * Shared search input and Filters drawer button used across all Ledger tab toolbars
 * (Visits, Patients, Invoices, Daybook) to keep filter layouts consistent without duplicating markup.
 */

export function ToolbarSearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  clearAriaLabel = 'Clear search',
  onBlur,
  className = 'min-w-0 flex-1 sm:w-56 sm:flex-none',
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
  clearAriaLabel?: string;
  onBlur?: () => void;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--muted)]">
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className="h-4 w-4"
        >
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
          <path d="M13.5 13.5L18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </div>
      <input
        type="search"
        aria-label={ariaLabel}
        className="h-10 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-8 text-sm text-[var(--ink)] placeholder-[var(--muted)] transition-colors hover:border-[var(--muted)] focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20 [&::-webkit-search-cancel-button]:hidden"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {value && (
        <button
          type="button"
          aria-label={clearAriaLabel}
          className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
          onMouseDown={(e) => {
            e.preventDefault();
            onChange('');
          }}
          onClick={() => onChange('')}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function ToolbarFilterToggle({
  open,
  activeCount,
  onToggle,
}: {
  open: boolean;
  activeCount: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={`flex h-10 min-h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
        activeCount > 0
          ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal)]'
          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]'
      }`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="h-3.5 w-3.5"
      >
        <path
          d="M2 3.5h12M4.5 8h7M7 12.5h2"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <span>Filters</span>
      {activeCount > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--teal)] px-1 text-[11px] font-semibold text-white">
          {activeCount}
        </span>
      )}
      <span className="text-xs opacity-60">{open ? '▲' : '▼'}</span>
    </button>
  );
}

