import { describe, expect, it } from 'vitest';
import {
  buildSetupSteps,
  completedStepsKey,
  isSetupNudgeVisible,
  lastBackupMetaKey,
  parseCompletedSteps,
  setupDismissedKey,
  summarizeSetup,
  type SetupSignals,
} from './setupGuide';

const none: SetupSignals = {
  clinicProfileSet: false,
  servicesPriced: false,
  teamInvited: false,
  therapistsLinked: false,
  visitLogged: false,
  backedUp: false,
  unlinkedTherapistCount: 0,
  catalogEmpty: true,
};

const established: SetupSignals = {
  clinicProfileSet: true,
  servicesPriced: true,
  teamInvited: true,
  therapistsLinked: true,
  visitLogged: true,
  backedUp: true,
  unlinkedTherapistCount: 0,
  catalogEmpty: false,
};

describe('setup meta keys', () => {
  it('keep the exact strings real devices already store', () => {
    expect(setupDismissedKey('c1')).toBe('firstWeekChecklistDismissed:c1');
    expect(completedStepsKey('c1')).toBe('firstWeekChecklistCompletedSteps:c1');
    expect(lastBackupMetaKey('c1')).toBe('lastBackupExportedAt:c1');
  });

  it('are scoped per clinic and never collide', () => {
    expect(completedStepsKey('a')).not.toBe(completedStepsKey('b'));
    const keys = [setupDismissedKey('a'), completedStepsKey('a'), lastBackupMetaKey('a')];
    expect(new Set(keys).size).toBe(3);
  });
});

describe('summarizeSetup', () => {
  const steps = buildSetupSteps(false, true);

  it('keeps the step ids stored completion depends on', () => {
    expect(steps.map((s) => s.id)).toEqual([
      'clinic-profile',
      'price-services',
      'invite-team',
      'link-therapist',
      'log-visit',
      'wait-synced',
      'clinical-notes',
      'backup',
    ]);
  });

  it('starts a fresh clinic at 0 with the profile as next', () => {
    const p = summarizeSetup(steps, none, new Set());
    expect(p.done).toBe(0);
    expect(p.total).toBe(8);
    expect(p.next?.id).toBe('clinic-profile');
    expect(p.steps.filter((s) => s.status === 'next')).toHaveLength(1);
  });

  it('counts auto steps from signals and manual steps from stored ticks', () => {
    const p = summarizeSetup(steps, established, new Set(['wait-synced']));
    expect(p.done).toBe(7);
    expect(p.next?.id).toBe('clinical-notes');
    const all = summarizeSetup(steps, established, new Set(['wait-synced', 'clinical-notes']));
    expect(all.allDone).toBe(true);
    expect(all.next).toBeNull();
  });

  it('ignores a stored tick for an auto step', () => {
    const p = summarizeSetup(steps, none, new Set(['clinic-profile']));
    expect(p.steps[0].status).toBe('next');
  });
});

describe('isSetupNudgeVisible', () => {
  const steps = buildSetupSteps(false, true);

  it('shows for a new clinic missing the basics', () => {
    expect(isSetupNudgeVisible(none, summarizeSetup(steps, none, new Set()), false)).toBe(true);
  });

  it("stays hidden for an established clinic that never ticked manual steps", () => {
    expect(isSetupNudgeVisible(established, summarizeSetup(steps, established, new Set()), false)).toBe(false);
  });

  it('respects an earlier dismissal', () => {
    expect(isSetupNudgeVisible(none, summarizeSetup(steps, none, new Set()), true)).toBe(false);
  });

  it('shows again when a therapist is left unlinked', () => {
    const s = { ...established, therapistsLinked: false, unlinkedTherapistCount: 1 };
    expect(isSetupNudgeVisible(s, summarizeSetup(steps, s, new Set()), false)).toBe(true);
  });
});

describe('parseCompletedSteps', () => {
  it('reads stored ids and tolerates bad values', () => {
    expect(parseCompletedSteps('["a","b",3]')).toEqual(new Set(['a', 'b']));
    expect(parseCompletedSteps('not json')).toEqual(new Set());
    expect(parseCompletedSteps(undefined)).toEqual(new Set());
  });
});
