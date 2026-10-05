import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { repos } from '@/services';
import { useEntitlements } from '@/app/useEntitlements';
import {
  buildSetupSteps,
  completedStepsKey,
  isSetupNudgeVisible,
  lastBackupMetaKey,
  parseCompletedSteps,
  setupDismissedKey,
  summarizeSetup,
  type SetupProgress,
  type SetupSignals,
} from '@/domain/setupGuide';

export interface SetupState extends SetupProgress {
  /** Whether the pinned bar on Workspace/Settings/account menu shows. */
  nudgeVisible: boolean;
  /** Tick or untick a manual step. */
  setManualDone: (stepId: string, done: boolean) => Promise<void>;
}

/**
 * Live setup progress for a clinic. `undefined` while any underlying query is
 * still loading, so callers render nothing rather than flashing a wrong count.
 * Takes `clinicId` (not `useClinic()`) because the account menu also uses it.
 */
export function useSetupProgress(clinicId: string): SetupState | undefined {
  const entitlements = useEntitlements(clinicId);
  const clinic = useLiveQuery(() => repos.clinics.get(clinicId), [clinicId]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinicId, true), [clinicId]);
  const catalog = useLiveQuery(() => repos.catalog.list(clinicId), [clinicId]);
  const hasVisits = useLiveQuery(() => repos.visits.list({ clinicId }).then((v) => v.length > 0), [clinicId]);
  // A missing row and "still loading" both read as undefined from useLiveQuery,
  // so map a missing row to an explicit empty value.
  const metaRows = useLiveQuery(async () => {
    const [backup, completed, dismissed] = await Promise.all([
      db.meta.get(lastBackupMetaKey(clinicId)),
      db.meta.get(completedStepsKey(clinicId)),
      db.meta.get(setupDismissedKey(clinicId)),
    ]);
    return {
      backup: backup?.value ?? '',
      completed: completed?.value ?? '',
      dismissed: dismissed?.value === '1',
    };
  }, [clinicId]);

  if (
    clinic === undefined ||
    therapists === undefined ||
    catalog === undefined ||
    hasVisits === undefined ||
    metaRows === undefined ||
    entitlements.loading
  ) {
    return undefined;
  }

  const unlinked = therapists.filter((t) => !t.userId).length;
  const signals: SetupSignals = {
    clinicProfileSet: Boolean(clinic?.address?.trim()),
    servicesPriced: catalog.length > 0,
    // A clinic_members row exists from the moment an invite is issued, so more
    // than one seat means someone besides the creating admin is on the team.
    teamInvited: (entitlements.seatsUsed ?? 0) > 1,
    therapistsLinked: therapists.length > 0 && unlinked === 0,
    visitLogged: hasVisits,
    backedUp: metaRows.backup !== '',
    unlinkedTherapistCount: unlinked,
    catalogEmpty: catalog.length === 0,
  };
  const steps = buildSetupSteps(
    entitlements.enforcementEnabled && entitlements.maxMembers <= 1,
    entitlements.can('invoicing')
  );
  const completed = parseCompletedSteps(metaRows.completed);
  const progress = summarizeSetup(steps, signals, completed);

  return {
    ...progress,
    nudgeVisible: isSetupNudgeVisible(signals, progress, metaRows.dismissed),
    setManualDone: async (stepId, done) => {
      const next = new Set(completed);
      if (done) next.add(stepId);
      else next.delete(stepId);
      await db.meta.put({ key: completedStepsKey(clinicId), value: JSON.stringify([...next]) });
    },
  };
}
