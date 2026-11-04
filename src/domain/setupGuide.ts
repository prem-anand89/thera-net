/**
 * Guided setup: the steps a new clinic works through, and how each one knows
 * it's done. Pure (no React, no Dexie) so it's testable on its own; the hooks
 * that feed it live in `src/features/setup/useSetupProgress.ts`.
 *
 * Moved here from the old First-Week Checklist. Step ids and the `db.meta`
 * keys below are unchanged on purpose: real devices already hold them, and
 * renaming either would make finished steps look unfinished again.
 */

/** `db.meta` is one global table shared by every clinic on the device, so
 *  every key is scoped by clinic id. */
export function setupDismissedKey(clinicId: string): string {
  return `firstWeekChecklistDismissed:${clinicId}`;
}
export function completedStepsKey(clinicId: string): string {
  return `firstWeekChecklistCompletedSteps:${clinicId}`;
}
/** Written by Settings → Account → Data backup on a successful export. */
export function lastBackupMetaKey(clinicId: string): string {
  return `lastBackupExportedAt:${clinicId}`;
}

/** Facts about the clinic that a live query can confirm. */
export interface SetupSignals {
  clinicProfileSet: boolean;
  servicesPriced: boolean;
  teamInvited: boolean;
  therapistsLinked: boolean;
  visitLogged: boolean;
  backedUp: boolean;
  /** Raw counts behind the visibility rule (see `isSetupNudgeVisible`). */
  unlinkedTherapistCount: number;
  catalogEmpty: boolean;
}

export type SetupStepLink =
  | {
      kind: 'settings';
      tab: 'general' | 'team' | 'services' | 'account' | 'billing' | 'booking';
      card?: 'referrals' | 'after-visit';
      teamView?: 'members' | 'shifts';
    }
  | { kind: 'new-visit' };

export type SetupGroup = 'essentials' | 'first-week' | 'optional';

export interface SetupStep {
  id: string;
  group: SetupGroup;
  title: string;
  /** One line on why it matters. */
  why: string;
  link?: SetupStepLink;
  /** Button label, naming the action. */
  action?: string;
  /** Derives done from signals. Steps without it are marked done by hand:
   *  "wait for Synced" is a habit, and "clinical notes" is a decision where
   *  on and off are both valid answers. */
  auto?: (signals: SetupSignals) => boolean;
}

export function buildSetupSteps(seatLimited: boolean, canInvoice: boolean, loginsFull = false): SetupStep[] {
  return [
    {
      id: 'clinic-profile',
      // The address is optional at sign-up. It only has to be there once bills can be issued (Solo and above); on a plan
      // without invoicing the step is a nudge that never holds up "setup complete".
      group: canInvoice ? 'essentials' : 'optional',
      title: 'Set up your clinic profile',
      why: 'Name and address print on every invoice.',
      link: { kind: 'settings', tab: 'general' },
      action: 'Open clinic profile',
      auto: (s) => s.clinicProfileSet,
    },
    {
      id: 'price-services',
      group: 'essentials',
      title: 'Price your services',
      why: 'Visits bill against these prices, so set them before logging visits.',
      link: { kind: 'settings', tab: 'services' },
      action: 'Open services & treatments',
      auto: (s) => s.servicesPriced,
    },
    {
      id: 'invite-team',
      // A one-login plan cannot invite anyone, so this is optional there: setup can reach 100% without it.
      group: seatLimited || loginsFull ? 'optional' : 'essentials',
      title: 'Invite your team',
      why: seatLimited
        ? 'Your plan has one login for now. Invite teammates after upgrading.'
        : loginsFull
          ? 'All the logins on your plan are in use. Invite more people after upgrading.'
        : 'Each person needs their own login so revenue is credited to the right therapist.',
      link: { kind: 'settings', tab: 'team', teamView: 'members' },
      action: 'Open team',
      auto: (s) => s.teamInvited,
    },
    {
      id: 'link-therapist',
      group: 'essentials',
      title: 'Link every therapist to their login',
      why: loginsFull
        ? 'All the logins on your plan are in use, so others stay on the schedule without one. Upgrade to link them.'
        : 'An unlinked therapist sees an empty Workspace.',
      link: { kind: 'settings', tab: 'team', teamView: 'members' },
      action: 'Open team',
      auto: (s) => s.therapistsLinked,
    },
    {
      id: 'log-visit',
      group: 'first-week',
      title: 'Log your first real visit',
      why: 'Invoices can only be issued against a saved visit.',
      link: { kind: 'new-visit' },
      action: 'New visit',
      auto: (s) => s.visitLogged,
    },
    {
      id: 'wait-synced',
      group: 'first-week',
      title: 'Wait for Synced before invoicing',
      why: canInvoice
        ? 'Visits save offline, but invoice numbers need a connection. Issue invoices only when the badge reads Synced.'
        : 'Invoicing isn’t on your plan yet. This applies once it is.',
    },
    {
      id: 'clinical-notes',
      group: 'first-week',
      title: 'Decide on clinical notes',
      why: 'Start with one willing therapist rather than the whole team.',
      link: { kind: 'settings', tab: 'general', card: 'after-visit' },
      action: 'Open After a visit',
    },
    {
      id: 'backup',
      group: 'first-week',
      title: 'Take a backup',
      why: 'Export once after your first real day, so you know the restore path.',
      link: { kind: 'settings', tab: 'account' },
      action: 'Open backup',
      auto: (s) => s.backedUp,
    },
    {
      id: 'billing',
      group: 'optional',
      title: 'Set up payments & billing',
      why: 'Add your UPI ID for payments, and your GST number if you issue invoices.',
      link: { kind: 'settings', tab: 'billing' },
      action: 'Open Payments & billing',
    },
    {
      id: 'booking',
      group: 'optional',
      title: 'Set hours & online booking',
      why: 'Check your open days and hours, and your booking link.',
      link: { kind: 'settings', tab: 'booking' },
      action: 'Open Schedule & Booking',
    },
    {
      id: 'notifications',
      group: 'optional',
      title: 'Turn on notifications',
      why: 'Open My account in the menu, then Notifications, to get push alerts on this device.',
    },
  ];
}

/**
 * The therapist-related signals. On a plan with one login (`seatLimited`) colleagues are team members without a
 * login by design, so only the owner's own row has to be linked and unlinked colleagues are never a reason to nudge.
 * Elsewhere every roster row should be linked to a login.
 */
export function therapistSignals(
  therapists: readonly { userId?: string | null }[],
  userId: string | undefined,
  seatLimited: boolean
): { therapistsLinked: boolean; unlinkedTherapistCount: number } {
  if (seatLimited) {
    return { therapistsLinked: Boolean(userId) && therapists.some((t) => t.userId === userId), unlinkedTherapistCount: 0 };
  }
  const unlinked = therapists.filter((t) => !t.userId).length;
  return { therapistsLinked: therapists.length > 0 && unlinked === 0, unlinkedTherapistCount: unlinked };
}

export type SetupStatus = 'done' | 'next' | 'pending';

export interface SetupProgress {
  steps: (SetupStep & { status: SetupStatus; manual: boolean })[];
  done: number;
  total: number;
  next: SetupStep | null;
  allDone: boolean;
}

export function stepIsDone(step: SetupStep, signals: SetupSignals, completed: Set<string>): boolean {
  return step.auto ? step.auto(signals) : completed.has(step.id);
}

export function summarizeSetup(
  steps: SetupStep[],
  signals: SetupSignals,
  completed: Set<string>
): SetupProgress {
  const doneFlags = steps.map((s) => stepIsDone(s, signals, completed));
  // Optional steps never count toward progress, "next" or completion.
  const isRequired = (i: number) => steps[i].group !== 'optional';
  const nextIndex = doneFlags.findIndex((d, i) => !d && isRequired(i));
  const requiredIdx = steps.map((_, i) => i).filter(isRequired);
  return {
    steps: steps.map((s, i) => ({
      ...s,
      manual: !s.auto,
      status: doneFlags[i] ? 'done' : i === nextIndex ? 'next' : 'pending',
    })),
    done: requiredIdx.filter((i) => doneFlags[i]).length,
    total: requiredIdx.length,
    next: nextIndex === -1 ? null : steps[nextIndex],
    allDone: nextIndex === -1,
  };
}

/**
 * Whether the pinned setup bar (Workspace, Settings, account menu) shows.
 * Only while the clinic still lacks the basics: a profile address, a priced
 * catalog, or a linked login for every therapist. Established clinics that
 * never ticked the manual first-week steps don't get a nudge back; the full
 * list stays reachable at /setup. A clinic that dismissed the old checklist
 * stays dismissed.
 */
export function isSetupNudgeVisible(
  signals: SetupSignals,
  progress: SetupProgress,
  dismissed: boolean
): boolean {
  if (dismissed || progress.allDone) return false;
  return !signals.clinicProfileSet || signals.catalogEmpty || signals.unlinkedTherapistCount > 0;
}

export function parseCompletedSteps(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    // corrupt value: treat as nothing completed
  }
  return new Set();
}
