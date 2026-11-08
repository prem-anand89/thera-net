/** "‹ Nov 2026 ›": one tap to the previous or next month. A disabled end says why to a screen reader. */
export function MonthStepper({
  label,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: {
  label: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const arrow = 'inline-flex min-h-8 min-w-8 items-center justify-center text-base text-[var(--ink)] disabled:text-[var(--border)]';
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)]">
      <button type="button" className={`${arrow} rounded-l-full pl-1`} disabled={!canPrev} aria-label={canPrev ? 'Previous month' : 'Previous month, not available'} onClick={onPrev}>
        ‹
      </button>
      <span className="px-1 text-xs font-medium text-[var(--ink)]" aria-live="polite">
        {label}
      </span>
      <button type="button" className={`${arrow} rounded-r-full pr-1`} disabled={!canNext} aria-label={canNext ? 'Next month' : 'Next month, not available'} onClick={onNext}>
        ›
      </button>
    </span>
  );
}
