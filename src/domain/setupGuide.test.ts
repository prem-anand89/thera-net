import { describe, expect, it } from 'vitest';
import {
  buildSetupSteps,
  therapistSignals,
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

  it('keeps the step ids stored completion depends on, with refined labels and links', () => {
    expect(steps.map((s) => s.id)).toEqual([
      'clinic-profile',
      'price-services',
      'invite-team',
      'link-therapist',
      'log-visit',
      'wait-synced',
      'clinical-notes',
      'backup',
      'billing',
      'booking',
      'notifications',
    ]);

    const priceServices = steps.find((s) => s.id === 'price-services')!;
    expect(priceServices.action).toBe('Open services & treatments');

    const clinicalNotes = steps.find((s) => s.id === 'clinical-notes')!;
    expect(clinicalNotes.action).toBe('Open After a visit');
    expect(clinicalNotes.link).toEqual({ kind: 'settings', tab: 'general', card: 'after-visit' });

    const billing = steps.find((s) => s.id === 'billing')!;
    expect(billing.title).toBe('Set up payments & billing');
    expect(billing.why).toBe('Add your UPI ID for payments, and your GST number if you issue invoices.');
    expect(billing.action).toBe('Open Payments & billing');

    const booking = steps.find((s) => s.id === 'booking')!;
    expect(booking.title).toBe('Set hours & online booking');
    expect(booking.why).toBe('Check your open days and hours, and your booking link.');
    expect(booking.action).toBe('Open Schedule & Booking');

    const inviteTeam = steps.find((s) => s.id === 'invite-team')!;
    expect(inviteTeam.link).toEqual({ kind: 'settings', tab: 'team', teamView: 'members' });

    const linkTherapist = steps.find((s) => s.id === 'link-therapist')!;
    expect(linkTherapist.link).toEqual({ kind: 'settings', tab: 'team', teamView: 'members' });
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

  it('does not let optional steps block completion or become next', () => {
    const p = summarizeSetup(steps, established, new Set(['wait-synced', 'clinical-notes']));
    expect(p.steps.find((s) => s.id === 'billing')?.status).toBe('pending');
    expect(p.done).toBe(p.total);
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

describe('a one-login plan (seat limited)', () => {
  const steps = buildSetupSteps(true, true);

  it('keeps the same step ids, so stored ticks still match', () => {
    expect(steps.map((s) => s.id)).toEqual(buildSetupSteps(false, true).map((s) => s.id));
  });

  it('makes "Invite your team" optional, so setup can reach 100% without it', () => {
    expect(steps.find((s) => s.id === 'invite-team')?.group).toBe('optional');
    expect(buildSetupSteps(false, true).find((s) => s.id === 'invite-team')?.group).toBe('essentials');
    const done = { ...established, teamInvited: false };
    const p = summarizeSetup(steps, done, new Set(['wait-synced', 'clinical-notes']));
    expect(p.allDone).toBe(true);
  });

  it('counts the owner linked, whatever colleagues without a login there are', () => {
    const roster = [{ userId: 'me' }, { userId: null }];
    expect(therapistSignals(roster, 'me', true)).toEqual({ therapistsLinked: true, unlinkedTherapistCount: 0 });
    // the same roster on a plan with several logins still wants every row linked
    expect(therapistSignals(roster, 'me', false)).toEqual({ therapistsLinked: false, unlinkedTherapistCount: 1 });
  });

  it('is not linked until the owner is on the roster', () => {
    expect(therapistSignals([{ userId: null }], 'me', true).therapistsLinked).toBe(false);
    expect(therapistSignals([], 'me', true).therapistsLinked).toBe(false);
    expect(therapistSignals([{ userId: 'me' }], undefined, true).therapistsLinked).toBe(false);
  });
});

describe('the clinic profile step without invoicing', () => {
  it('is optional on a plan that cannot invoice (the address matters once bills can be issued), essential otherwise', () => {
    expect(buildSetupSteps(false, false).find((s) => s.id === 'clinic-profile')?.group).toBe('optional');
    expect(buildSetupSteps(false, true).find((s) => s.id === 'clinic-profile')?.group).toBe('essentials');
  });

  it('lets a Lite clinic with no address finish setup', () => {
    const lite = buildSetupSteps(true, false);
    const s = { ...established, clinicProfileSet: false };
    expect(summarizeSetup(lite, s, new Set(['wait-synced', 'clinical-notes'])).allDone).toBe(true);
  });

  it('with every login in use, inviting is optional and the copy says to upgrade; the steps keep their ids', () => {
    const full = buildSetupSteps(false, true, true);
    expect(full.map((s) => s.id)).toEqual(buildSetupSteps(false, true).map((s) => s.id));
    const invite = full.find((s) => s.id === 'invite-team')!;
    expect(invite.group).toBe('optional');
    expect(invite.why).toBe('All the logins on your plan are in use. Invite more people after upgrading.');
    const link = full.find((s) => s.id === 'link-therapist')!;
    expect(link.why).toMatch(/Upgrade to link them/);
    expect(link.group).toBe('optional');
    // Below the limit nothing changes.
    expect(buildSetupSteps(false, true).find((s) => s.id === 'invite-team')!.group).toBe('essentials');
  });

  it('therapist signals treat a full plan like a one-login plan: only the owner has to be linked', () => {
    const team = [{ userId: 'u1' }, { userId: null }];
    expect(therapistSignals(team, 'u1', true)).toEqual({ therapistsLinked: true, unlinkedTherapistCount: 0 });
    expect(therapistSignals(team, 'u1', false)).toEqual({ therapistsLinked: false, unlinkedTherapistCount: 1 });
  });
});
