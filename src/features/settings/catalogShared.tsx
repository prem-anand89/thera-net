import { type ReactNode } from 'react';
import { NameTakenError, nameCheckBlocks, type NameCheckResult, type NamedItem } from '@/domain/nameCheck';
import { toFriendlyMessage } from '@/lib/errors';

/** Pieces shared by the Services, Treatments and How patients found you lists. */

/** A name refused by `catalogService` reads as itself; anything else gets the usual friendly message. */
export function saveErrorMessage(e: unknown): string {
  return e instanceof NameTakenError ? e.message : toFriendlyMessage(e);
}

/**
 * The live name check under a name box: the same name (capitals ignored) blocks and says so; a hidden one offers to
 * switch it back on; a near match only asks. Renders nothing when the name is free.
 */
export function NameCheckNote<T extends NamedItem>({
  result,
  hiddenText,
  restoreLabel,
  onRestore,
  onUse,
}: {
  result: NameCheckResult<T>;
  /** e.g. "is in No longer offered" / "is hidden". */
  hiddenText: string;
  restoreLabel?: string;
  onRestore?: (match: T) => void;
  onUse: (name: string) => void;
}) {
  const match = result.match;
  if (!match || result.kind === 'none') return null;
  const name = match.name.trim();
  const block = nameCheckBlocks(result);
  const action =
    result.kind === 'hidden' && onRestore && restoreLabel
      ? { label: restoreLabel, run: () => onRestore(match) }
      : result.kind === 'similar'
        ? { label: `Use ${name}`, run: () => onUse(name) }
        : null;
  const text =
    result.kind === 'exact'
      ? `You already have ${name}.`
      : result.kind === 'hidden'
        ? `${name} ${hiddenText}.`
        : `You already have ${name}. Use that?`;
  return (
    <div
      role={block ? 'alert' : 'status'}
      className={`mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-xs ${
        block ? 'bg-[var(--rust-light)] text-[var(--rust)]' : 'bg-[var(--amber-light)] text-[var(--amber-strong)]'
      }`}
    >
      <span>{text}</span>
      {action && (
        <button type="button" className="min-h-8 rounded-md border border-current px-2.5 font-semibold" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}
/** Only ever rendered for the exception (inactive) — an active item is
 *  already the default, unflagged state, so badging it on every row added
 *  no information and just cluttered the common case. */
export function InactivePill() {
  return (
    <span
      className="inline-block self-start rounded-full px-2.5 py-0.5 text-caption font-semibold"
      style={{ background: 'var(--paper)', color: 'var(--muted)' }}
    >
      Hidden
    </span>
  );
}

/** A visible bordered button, not a bare "text + hover:underline" link —
 *  the underline-on-hover alone gave no affordance on touch devices,
 *  which have no hover state, so Edit/Deactivate/Rename read as plain
 *  text until tapped. */
export function CatalogActionButton({
  tone = 'teal',
  children,
  onClick,
}: {
  tone?: 'teal' | 'rust';
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        tone === 'rust'
          ? 'min-h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-hint font-semibold text-[var(--rust)] hover:bg-[var(--rust-light)]'
          : 'min-h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-hint font-semibold text-[var(--teal)] hover:bg-[var(--teal-light)]'
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function CatalogCardShell({
  active,
  children,
  footer,
}: {
  active: boolean;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      className={`flex h-full flex-col gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm ${active ? '' : 'opacity-60'}`}
    >
      {children}
      <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--border)] pt-2.5">
        {footer}
      </div>
    </div>
  );
}

export function CatalogAddCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--paper)] p-4">
      <h4 className="text-sm font-semibold text-[var(--ink)]">{title}</h4>
      {hint && <p className="mt-1 mb-3 text-xs text-[var(--muted)]">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </div>
  );
}

export const DURATION_HINT = 'Per session for a package. Used for time reports; leave blank to count the whole session.';
export const DURATION_ERROR = 'Enter minutes between 1 and 480, or leave it blank.';

/** Blank -> null (valid); a whole number 1-480 -> that number; anything else
 *  -> undefined (invalid). The database check rejects values outside 1-480,
 *  so the form must never send one. */
export function parseDuration(raw: string): number | null | undefined {
  const t = raw.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 && n <= 480 ? n : undefined;
}


/**
 * A small on/off for a list view (e.g. "Show usage"): the same track-and-thumb as `SwitchRow`, sized for a card
 * header. It is a view switch, not a setting.
 */
export function MiniSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
      {label}
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-5 w-9 shrink-0 rounded-full bg-[var(--border)] transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform after:content-[''] peer-checked:bg-[var(--teal)] peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--teal)] peer-focus-visible:ring-offset-2"
      />
    </label>
  );
}

/** The collapsed footer at the bottom of a list: "› No longer offered (3)" / "› Hidden (1)". */
export function HiddenItemsFooter({ label, count, open, onToggle, children }: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] bg-[var(--paper)]">
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-[var(--muted)]"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span aria-hidden="true" className="inline-block transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>
          ›
        </span>
        <span className="font-medium text-[var(--ink)]">{label}</span>
        <span>({count})</span>
      </button>
      {open && <div className="border-t border-[var(--border)] bg-[var(--surface)]">{children}</div>}
    </div>
  );
}
