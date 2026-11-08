import { describe, expect, it } from 'vitest';
import { resolveWorkspaceView } from './workspaceView';

const NONE = '00000000-0000-0000-0000-000000000000';
const therapist = { isClinicWideView: false, myTherapistId: 't1', scopeTherapistId: 't1' };
const unlinkedTherapist = { isClinicWideView: false, myTherapistId: undefined, scopeTherapistId: NONE };
const treatingAdmin = { isClinicWideView: true, myTherapistId: 't1', scopeTherapistId: undefined };
const admin = { isClinicWideView: true, myTherapistId: undefined, scopeTherapistId: undefined };

describe('resolveWorkspaceView', () => {
  it('opens a therapist on Mine and lets them switch to All', () => {
    expect(resolveWorkspaceView(therapist, null)).toEqual({ canToggle: true, mineOnly: true, viewTherapistId: 't1' });
    expect(resolveWorkspaceView(therapist, 'all')).toEqual({ canToggle: true, mineOnly: false, viewTherapistId: undefined });
  });

  it('opens an admin who treats on All and lets them switch to Mine', () => {
    expect(resolveWorkspaceView(treatingAdmin, null)).toEqual({ canToggle: true, mineOnly: false, viewTherapistId: undefined });
    expect(resolveWorkspaceView(treatingAdmin, 'mine')).toEqual({ canToggle: true, mineOnly: true, viewTherapistId: 't1' });
  });

  it('gives an admin or front desk without a therapist row no switch and the whole clinic, whatever was chosen', () => {
    expect(resolveWorkspaceView(admin, null)).toEqual({ canToggle: false, mineOnly: false, viewTherapistId: undefined });
    expect(resolveWorkspaceView(admin, 'mine')).toEqual({ canToggle: false, mineOnly: false, viewTherapistId: undefined });
  });

  it('narrows a therapist with no linked row to nothing, not to the whole clinic', () => {
    expect(resolveWorkspaceView(unlinkedTherapist, null)).toEqual({ canToggle: false, mineOnly: true, viewTherapistId: NONE });
    expect(resolveWorkspaceView(unlinkedTherapist, 'all')).toEqual({ canToggle: false, mineOnly: true, viewTherapistId: NONE });
  });

  it('is right as soon as the therapist row appears, with no stale starting value', () => {
    const loading = { isClinicWideView: false, myTherapistId: undefined, scopeTherapistId: NONE };
    expect(resolveWorkspaceView(loading, null).viewTherapistId).toBe(NONE);
    expect(resolveWorkspaceView(therapist, null).viewTherapistId).toBe('t1');
  });
});
