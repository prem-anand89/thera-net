export function OnboardingProgress({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="mb-6 flex items-center gap-2">
      {[1, 2, 3].map((n, i) => (
        <div key={n} className="flex items-center gap-2">
          <div
            className="h-2 w-2 rounded-full"
            style={{
              background: n <= step ? 'var(--teal)' : 'var(--border)',
              boxShadow:
                n === step ? '0 0 0 3px color-mix(in srgb, var(--teal) 25%, transparent)' : undefined,
            }}
            aria-hidden
          />
          {i < 2 && (
            <div
              className="h-0.5 w-8"
              style={{ background: n < step ? 'var(--teal)' : 'var(--border)' }}
              aria-hidden
            />
          )}
        </div>
      ))}
      <span className="ml-auto text-xs font-medium text-[var(--muted)]">Step {step} of 3</span>
    </div>
  );
}
