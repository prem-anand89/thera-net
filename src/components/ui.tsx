import { useState, type ReactNode } from 'react';
import { paiseToRupees, rupeesToPaise, type Paise } from '@/domain/money';

export const inputCls =
  'w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-[var(--teal)] focus:outline-none disabled:bg-[var(--paper)]';
export const btnPrimary =
  'rounded-md bg-[var(--teal)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--teal-strong)] disabled:opacity-50';
export const btnSecondary =
  'rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--muted)] hover:bg-[var(--paper)] disabled:opacity-50';

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">{label}</span>
      {children}
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
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="font-num mt-0.5 text-base font-semibold text-[var(--ink)]">{value}</div>
    </div>
  );
}

const PILL_TONES = {
  green: 'bg-[var(--moss-light)] text-[var(--moss)]',
  amber: 'bg-[var(--rust-light)] text-[var(--rust)]',
  slate: 'bg-[var(--paper)] text-[var(--muted)]',
} as const;

/** Status badge. Pair color with words/icons — never color alone. */
export function Pill({ tone, children }: { tone: keyof typeof PILL_TONES; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${PILL_TONES[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Small "?" affordance explaining a jargon term inline. A tap/click toggles a
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
        const tone = n < sessionIndex ? 'bg-[var(--moss)]' : n === sessionIndex ? 'bg-[var(--teal)]' : 'bg-[var(--border)]';
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
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-[var(--ink)]/40" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-[var(--ink)]">{title}</h2>
          <button type="button" aria-label="Close" className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--paper)]" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
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
