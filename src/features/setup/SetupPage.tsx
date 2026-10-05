import { Link } from '@tanstack/react-router';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { btnPrimary, btnSecondary } from '@/components/ui';
import type { SetupGroup, SetupStep, SetupStepLink, SetupStatus } from '@/domain/setupGuide';
import { useSetupProgress } from './useSetupProgress';
import { SetupTicks } from './SetupTicks';

const GROUP_TITLES: Record<SetupGroup, string> = {
  essentials: 'Essentials',
  'first-week': 'Your first week',
  optional: 'Optional setup',
};

function StepAction({ link, label, primary }: { link: SetupStepLink; label: string; primary: boolean }) {
  const className = primary ? btnPrimary : btnSecondary;
  if (link.kind === 'new-visit') {
    return (
      <Link to="/visits/new" className={className}>
        {label}
      </Link>
    );
  }
  return (
    <Link to="/settings" search={{ tab: link.tab as any, fromSetup: true }} className={className}>
      {label}
    </Link>
  );
}

function StepCard({
  step,
  status,
  manual,
  onToggle,
}: {
  step: SetupStep;
  status: SetupStatus;
  manual: boolean;
  onToggle: (done: boolean) => void;
}) {
  const done = status === 'done';
  const next = status === 'next';
  return (
    <li
      className={`rounded-xl border p-4 ${
        next
          ? 'border-[var(--teal)]/50 bg-[var(--surface)] shadow-[var(--shadow-2)]'
          : done
            ? 'border-transparent bg-[var(--teal-mist)]'
            : 'border-[var(--border)] bg-[var(--surface)]'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            done
              ? 'bg-[var(--moss)] text-white'
              : next
                ? 'bg-[var(--surface)] text-[var(--teal)] ring-2 ring-[var(--teal)]'
                : 'border border-[var(--border)] text-[var(--muted)]'
          }`}
        >
          {done ? '✓' : ''}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${done ? 'text-[var(--muted)]' : 'text-[var(--ink)]'}`}>
            {step.title}
            <span className="sr-only">{done ? ', done' : next ? ', next step' : ', not done'}</span>
          </p>
          {!done && <p className="mt-1 text-sm text-[var(--muted)]">{step.why}</p>}
          {!done && (step.link || manual) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {step.link && step.action && <StepAction link={step.link} label={step.action} primary={next} />}
              {manual && (
                <button type="button" className={btnSecondary} onClick={() => onToggle(true)}>
                  Mark done
                </button>
              )}
            </div>
          )}
        </div>
        {done && manual && (
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]"
            onClick={() => onToggle(false)}
          >
            Undo
          </button>
        )}
      </div>
    </li>
  );
}

export function SetupPage() {
  const clinic = useClinic();
  const { canEditSettings } = usePermissions();
  const setup = useSetupProgress(clinic.id);

  if (!canEditSettings) {
    return (
      <div className="space-y-2">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Setup</h1>
        <p className="text-sm text-[var(--muted)]">Clinic setup is done by your clinic admin.</p>
      </div>
    );
  }

  if (!setup) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const groups: SetupGroup[] = ['essentials', 'first-week', 'optional'];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="rounded-[20px] bg-[var(--teal-deep)] px-5 py-6 text-white sm:px-7 sm:py-8">
        <p className="text-sm text-white/70">{clinic.name}</p>
        <h1 className="mt-1 font-display text-[28px] font-semibold leading-[1.15] tab:text-4xl">
          {setup.allDone ? 'Setup complete' : 'Set up your clinic'}
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SetupTicks statuses={setup.steps.map((s) => s.status)} size="lg" />
          <span className="font-num text-sm text-white/80">
            {setup.done} of {setup.total} done
          </span>
        </div>
        {setup.allDone ? (
          <p className="mt-3 text-sm text-white/80">Everything’s in place. You can come back here any time.</p>
        ) : (
          setup.next && <p className="mt-3 text-sm text-white/80">Next: {setup.next.title}</p>
        )}
      </section>

      {groups.map((group) => {
        const steps = setup.steps.filter((s) => s.group === group);
        return (
          <section key={group} aria-labelledby={`setup-${group}`} className="space-y-3">
            <h2 id={`setup-${group}`} className="font-display text-lg font-semibold text-[var(--ink)]">
              {GROUP_TITLES[group]}
            </h2>
            <ol className="space-y-2">
              {steps.map((step) => (
                <StepCard
                  key={step.id}
                  step={step}
                  status={step.status}
                  manual={step.manual}
                  onToggle={(done) => void setup.setManualDone(step.id, done)}
                />
              ))}
            </ol>
          </section>
        );
      })}

      <Link to="/workspace" className="inline-block text-sm font-medium text-[var(--teal)] hover:underline">
        Back to Workspace
      </Link>
    </div>
  );
}
