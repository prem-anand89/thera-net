import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { paiseToRupees, rupeesToPaise, type Paise } from '@/domain/money';

export const inputCls =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base sm:text-sm focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/30 disabled:bg-[var(--paper)]';
export const btnPrimary =
  'min-h-11 rounded-lg bg-[var(--teal)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--teal-strong)] disabled:opacity-50';
export const btnSecondary =
  'min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--muted)] hover:bg-[var(--paper)] disabled:opacity-50';
/** A row inside a `KebabMenu` dropdown — pair with `menuItemDestructive` for Delete-style actions. */
export const menuItem =
  'block w-full px-3 py-1.5 text-left text-xs text-[var(--ink)] hover:bg-[var(--paper)]';
export const menuItemDestructive =
  'block w-full px-3 py-1.5 text-left text-xs text-[var(--rust)] hover:bg-[var(--rust-light)]';

/** Icon + wordmark header for the sign-in/sign-up/reset-password screens. */
export function AuthBrandHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="mb-6 flex flex-col items-center gap-2">
      <img src="/apple-touch-icon.png" alt="" className="h-12 w-12 rounded-[12px]" />
      <h1 className="font-display text-xl font-semibold text-[var(--ink)]">Thera.Net</h1>
      <p className="text-sm text-[var(--muted)]">{subtitle}</p>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  /** Small note under the label — e.g. "From patient's note — edit if
   *  needed" on a pre-filled field. Omit when there's nothing to say. */
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
      <h2 className="font-display mb-3 text-base font-semibold text-[var(--ink)]">{title}</h2>
      {children}
    </section>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md border border-[var(--rust)] bg-[var(--rust-light)] px-3 py-2 text-sm text-[var(--rust)]">
      {message}
    </p>
  );
}

/** Text input holding rupees, reporting paise. Blank ⇒ null. */
export function RupeeInput({
  valuePaise,
  onChange,
  disabled,
}: {
  valuePaise: Paise | null;
  onChange: (paise: Paise | null) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      min={0}
      step="1"
      inputMode="decimal"
      className={`font-num ${inputCls}`}
      disabled={disabled}
      value={valuePaise == null ? '' : paiseToRupees(valuePaise)}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === '' ? null : rupeesToPaise(Number(raw)));
      }}
    />
  );
}

/** Small caption-over-number tile for summary strips. Deliberately compact
 *  — sized to sit three-plus across even on a phone, not one per row — so a
 *  strip of them reads as a glanceable stat bar instead of eating most of
 *  the screen before any actual content shows. */
export function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-[86px] flex-1 basis-[86px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 shadow-sm">
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div className="font-num mt-0.5 whitespace-nowrap text-lg font-semibold text-[var(--ink)] sm:text-2xl">
        {value}
      </div>
    </div>
  );
}

const PILL_TONES = {
  green: 'bg-[var(--moss-light)] text-[var(--moss)]',
  // True amber (caution) — was aliased to the rust palette before the
  // Billing & Notes Rebuild Phase 1 badge collapse needed a genuinely
  // distinct, more urgent tone for Overdue than for Due/Partial. Callers
  // using "amber" today (the package "Not invoiced" pill, the "Stale"
  // patient badge) shift from rust- to amber-toned as a result — a
  // deliberate, coherent fix, not incidental: it now matches how the rest
  // of the app already uses these two colors (screening-banner/flag-pill's
  // amber = caution vs. rust = alert distinction).
  amber: 'bg-[var(--amber-light)] text-[var(--amber)]',
  rust: 'bg-[var(--rust-light)] text-[var(--rust)]',
  slate: 'bg-[var(--paper)] text-[var(--muted)]',
  teal: 'bg-[var(--teal-light)] text-[var(--teal)]',
} as const;

/** Status badge. Pair color with words/icons — never color alone. */
export function Pill({ tone, children }: { tone: keyof typeof PILL_TONES; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Therapist name badge — teal fill so "who treated" stands out from condition/treatment text. */
export function TherapistPill({ children }: { children: ReactNode }) {
  return <Pill tone="teal">{children}</Pill>;
}

/**
 * A small numeric counter badge — genuinely new, not a relabeled `Pill`:
 * `SyncBadge` is a status pill (a word, not a count) and the Reports trend
 * badge is a %-with-arrow, neither fits a plain "N of these need
 * attention" count. Renders nothing at 0 — a badge reading "0" still reads
 * as something to look at, when there's nothing to do.
 */
export function CountBadge({ count, tone }: { count: number; tone: keyof typeof PILL_TONES }) {
  if (count === 0) return null;
  return (
    <span
      className={`ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${PILL_TONES[tone]}`}
    >
      {count}
    </span>
  );
}

/**
 * Generic ⋮ trigger + dropdown menu for a row's actions. Rendered via a
 * portal to `document.body`, positioned with `position: fixed` from the
 * trigger button's own `getBoundingClientRect()` — NOT nested inside the
 * trigger's own DOM subtree. This isn't cosmetic: a row-actions menu
 * lives inside a horizontally-scrollable table wrapper
 * (`overflow-x-auto`), and per the CSS Overflow spec, once one axis of a
 * box has a non-`visible` overflow, the UA forces the OTHER axis's
 * computed value to `auto` too, even if it's explicitly authored as
 * `visible` — there is no CSS-only way to scroll one axis while a
 * descendant genuinely overflows the other. (Confirmed directly: a bare
 * `overflow-x: auto; overflow-y: visible` div still computes
 * `overflow-y: auto`, clipping any child that pokes past its bottom
 * edge.) An earlier fix attempted `overflow-y-visible` on the wrapper for
 * exactly this reason and didn't actually solve it, for exactly this
 * reason — only escaping the scroll container's DOM subtree entirely
 * (this portal) does. Flips to open above the trigger whenever there
 * isn't room to open below within the viewport, computed at the moment
 * it's opened, and closes automatically on scroll (any scroll container,
 * captured via a window-level capture-phase listener since `scroll`
 * doesn't bubble) since a `position: fixed` menu can't track its trigger
 * moving under it.
 */
export function KebabMenu({
  children,
  ariaLabel = 'Row actions',
}: {
  children: (close: () => void) => ReactNode;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function toggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const estimatedMenuHeight = 170;
      const openUpward = window.innerHeight - rect.bottom < estimatedMenuHeight;
      const right = window.innerWidth - rect.right;
      setPos(
        openUpward
          ? { bottom: window.innerHeight - rect.top + 4, right }
          : { top: rect.bottom + 4, right }
      );
    }
    setOpen((o) => !o);
  }

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <div className="shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        className="flex h-10 w-10 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--paper)]"
        onClick={toggle}
      >
        ⋮
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-10" onClick={close} />
            <div
              className="fixed z-30 min-w-32 rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg"
              style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}
            >
              {children(close)}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

/** Small "?" affordance explaining a jargon term inline. A tap/click toggles a
 * visible bubble — relying on the native `title` attribute alone doesn't
 * work on phones/tablets, since there's no hover state to trigger it, and
 * these are aimed squarely at non-technical staff who may be on one.
 */
export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        aria-label={text}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-flex h-3.5 w-3.5 shrink-0 select-none items-center justify-center rounded-full bg-[var(--border)] text-[10px] font-semibold leading-none text-[var(--muted)] hover:bg-[var(--teal-light)]"
      >
        ?
      </button>
      {open && (
        <span className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md bg-[var(--ink)] px-2.5 py-1.5 text-left text-xs font-normal leading-snug text-white">
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * Compact dot-thread showing progress through a multi-session package —
 * filled for sessions logged, teal for the current one, hollow for the rest.
 * A glanceable stand-in for "session 2 of 3" that scans in a table row.
 */
export function PackageThread({
  sessionIndex,
  packageTotal,
}: {
  sessionIndex: number;
  packageTotal: number;
}) {
  return (
    <span
      className="inline-flex items-center gap-0.5 align-middle"
      title={`Session ${sessionIndex} of ${packageTotal}`}
    >
      {Array.from({ length: packageTotal }, (_, i) => {
        const n = i + 1;
        const tone =
          n < sessionIndex
            ? 'bg-[var(--moss)]'
            : n === sessionIndex
              ? 'bg-[var(--teal)]'
              : 'bg-[var(--border)]';
        return <span key={n} className={`h-1.5 w-1.5 rounded-full ${tone}`} />;
      })}
    </span>
  );
}

const SUMMARY_BAR_TONES = {
  rust: 'bg-[var(--rust-light)] text-[var(--rust)]',
  neutral: 'bg-[var(--surface)] text-[var(--ink)] border border-[var(--border)]',
} as const;

/**
 * Collapsed entry point for a Panel — a slim tappable bar rather than
 * rendering its content inline. Two configured uses today: Needs-attention
 * (rust) and Recently-seen (neutral), sharing this one pair rather than two
 * bespoke implementations.
 */
export function SummaryBar({
  tone,
  label,
  count,
  onClick,
}: {
  tone: keyof typeof SUMMARY_BAR_TONES;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-medium shadow-sm ${SUMMARY_BAR_TONES[tone]}`}
    >
      <span>
        {tone === 'rust' && count != null ? `⚠ ${count} ` : ''}
        {label}
      </span>
      <span aria-hidden>›</span>
    </button>
  );
}

/**
 * Bottom-sheet overlay opened by a SummaryBar. Full-screen scrim, sheet
 * anchored to the bottom edge (rounded top corners) rather than centered —
 * distinct from the existing centered invoice-issuance modal pattern.
 */
export function Panel({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-[var(--ink)]/40"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-[var(--ink)]">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--paper)]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Centered confirm/type-to-confirm dialog — replaces native `confirm()` /
 * `prompt()` across the app with the same visual shell as TakePaymentDialog
 * / EditVisitModal / IssueInvoiceDialog. Plain confirms just need
 * onConfirm/onCancel; a destructive action that used to gate on `prompt()`
 * passes `typeToConfirm` — the confirm button stays disabled until
 * `isMatch` returns true, so there's no separate "name didn't match" alert
 * to write or dismiss.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  typeToConfirm,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  typeToConfirm?: { placeholder: string; isMatch: (typed: string) => boolean };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  if (!open) return null;
  const canConfirm = !typeToConfirm || typeToConfirm.isMatch(typed);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm space-y-3 rounded-[10px] bg-[var(--surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
        <p className="whitespace-pre-line text-sm text-[var(--muted)]">{message}</p>
        {typeToConfirm && (
          <input
            autoFocus
            className={inputCls}
            placeholder={typeToConfirm.placeholder}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnSecondary} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              destructive
                ? 'min-h-11 rounded-lg border border-[var(--rust)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--rust)] hover:bg-[var(--rust-light)] disabled:opacity-50'
                : btnPrimary
            }
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export const th =
  'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]';
export const td = 'px-3 py-3 text-sm text-[var(--ink)]';
export const tdNum = 'font-num px-3 py-3 text-sm text-[var(--ink)] text-right';
export const thNum =
  'px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]';

export type MultiToggleOption = string | { value: string; label: string };

/** Toggle-chip multi-select: value is the array of selected option values.
 *  Options can be plain strings (value === label) or {value, label} pairs —
 *  the latter for pickers backed by an id (e.g. a clinic-editable catalog)
 *  where the displayed label isn't the value being stored. */
export function MultiToggle({
  options,
  value,
  onChange,
}: {
  options: readonly MultiToggleOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="chip-row">
      {options.map((opt) => {
        const { value: optValue, label } =
          typeof opt === 'string' ? { value: opt, label: opt } : opt;
        const on = value.includes(optValue);
        return (
          <button
            key={optValue}
            type="button"
            className={`toggle-chip ${on ? 'on' : ''}`}
            onClick={() =>
              onChange(on ? value.filter((v) => v !== optValue) : [...value, optValue])
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Toggle-chip single-select: value is the one selected option value, or
 *  '' for none. Clicking the already-selected chip clears it back to ''
 *  rather than locking once picked, matching the "not assessed"
 *  empty-state convention other pickers in this app already use. Same
 *  .toggle-chip/.chip-row styling as MultiToggle, no new CSS. */
export function SingleToggle({
  options,
  value,
  onChange,
}: {
  options: readonly MultiToggleOption[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="chip-row">
      {options.map((opt) => {
        const { value: optValue, label } =
          typeof opt === 'string' ? { value: opt, label: opt } : opt;
        const on = value === optValue;
        return (
          <button
            key={optValue}
            type="button"
            className={`toggle-chip ${on ? 'on' : ''}`}
            onClick={() => onChange(on ? '' : optValue)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
