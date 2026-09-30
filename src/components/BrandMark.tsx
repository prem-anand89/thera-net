import type { ReactNode } from 'react';

/**
 * The Thera.Net app mark — the product, never the clinic. Clinic identity
 * (its own uploaded logo and name) lives in the header's clinic pill
 * (`ClinicSwitcher`) so the two never blur together.
 */
export function BrandMark({
  size = 28,
  wordmark = false,
  wordmarkClassName = '',
  className = '',
  decorative = false,
}: {
  size?: number;
  /** The name is already written right beside it — hide the image from screen readers. */
  decorative?: boolean;
  /** Show "Thera.Net" beside the mark. */
  wordmark?: boolean;
  /** Extra classes for the wordmark, e.g. `hidden desktop:inline`. */
  wordmarkClassName?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-2 ${className}`.trim()}>
      <img
        src="/apple-touch-icon.png"
        alt={wordmark || decorative ? '' : 'Thera.Net'}
        width={size}
        height={size}
        className="shrink-0 object-contain"
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }}
      />
      {wordmark && (
        <span className={`font-display font-semibold tracking-tight text-[var(--ink)] ${wordmarkClassName}`.trim()}>
          Thera.Net
        </span>
      )}
    </span>
  );
}

/** Full-screen loading state: the app mark with a quiet spinner. */
export function AppLoading({ label = 'Loading…', children }: { label?: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--paper)] px-4 text-center" role="status" aria-live="polite">
      <BrandMark size={48} decorative />
      <span className="font-display text-lg font-semibold text-[var(--ink)]">Thera.Net</span>
      <span className="flex items-center gap-2 text-sm text-[var(--muted)]">
        <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--teal)]" />
        {label}
      </span>
      {children}
    </div>
  );
}

/** "Powered by Thera.Net" — the footer on patient-facing public pages. */
export function PoweredBy() {
  return (
    <p className="flex items-center justify-center gap-1.5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 text-xs text-[var(--muted)]">
      <span>Powered by</span>
      <BrandMark size={16} wordmark wordmarkClassName="text-xs text-[var(--muted)]" />
    </p>
  );
}
