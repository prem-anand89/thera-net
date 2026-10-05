import { Link } from '@tanstack/react-router';
import { useSetupProgress } from './useSetupProgress';
import { SetupTicks } from './SetupTicks';

/** The pinned "Step 3 of 8" bar on Workspace and Settings. Shows only while
 *  the clinic still lacks the basics (see `isSetupNudgeVisible`); links to
 *  the full list at /setup. */
export function SetupProgressBar({ clinicId, className }: { clinicId: string; className?: string }) {
  const setup = useSetupProgress(clinicId);
  if (!setup?.nudgeVisible) return null;
  const stepNumber = setup.next ? setup.steps.findIndex((s) => s.id === setup.next!.id) + 1 : setup.total;
  return (
    <Link
      to="/setup"
      className={`flex min-h-11 items-center gap-3 rounded-xl border border-[var(--teal-light)] bg-[var(--teal-mist)] px-3.5 py-2 hover:border-[var(--teal)]/40 ${className ?? ''}`}
    >
      <SetupTicks statuses={setup.steps.map((s) => s.status)} />
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">
        <span className="font-medium">
          Step {stepNumber} of {setup.total}:
        </span>{' '}
        {setup.next?.title}
      </span>
      <span className="shrink-0 text-sm font-medium text-[var(--teal)]">Continue</span>
    </Link>
  );
}
