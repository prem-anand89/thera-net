const STEPS = ['Clinic', 'Team', 'Services', 'Done'] as const;

/** Named steps: 1 Clinic, 2 Team (the password sub-step stays inside Team),
 *  3 Services, 4 Done. Reads as "Team 2 of 4", not a bare dot count. */
export function OnboardingProgress({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label={`Setup step ${step} of ${STEPS.length}`}>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              aria-current={current ? 'step' : undefined}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                done
                  ? 'bg-[var(--moss)] text-white'
                  : current
                    ? 'bg-[var(--teal)] text-white ring-4 ring-[var(--teal)]/20'
                    : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]'
              }`}
            >
              {done ? '✓' : n}
            </span>
            <span
              className={`truncate text-xs font-medium ${current ? 'text-[var(--ink)]' : 'text-[var(--muted)]'}`}
            >
              {label}
            </span>
            {n < STEPS.length && (
              <span aria-hidden className={`h-px flex-1 ${done ? 'bg-[var(--moss)]' : 'bg-[var(--border)]'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
