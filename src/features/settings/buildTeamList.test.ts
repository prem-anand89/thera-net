import { describe, expect, it } from 'vitest';
import type { Therapist } from '@/domain/types';
import { buildTeamList } from './SettingsPage';

const therapist = (overrides: Partial<Therapist> & Pick<Therapist, 'id' | 'name'>): Therapist => ({
  clinicId: 'c1',
  active: true,
  userId: null,
  updatedAt: '',
  ...overrides,
});

describe('buildTeamList', () => {
  it('merges therapist and member by userId', () => {
    const list = buildTeamList(
      [
        {
          userId: 'u1',
          email: 'a@example.com',
          role: 'therapist',
          displayName: 'Dr A',
          status: 'active',
          invitedAt: null,
          lastSignInAt: null,
          lastActiveAt: null,
        },
      ],
      [therapist({ id: 't1', name: 'Dr A', userId: 'u1' })]
    );
    expect(list).toHaveLength(1);
    expect(list[0].member?.userId).toBe('u1');
    expect(list[0].therapist?.id).toBe('t1');
  });

  it('does not treat therapists as unlinked while members are still loading', () => {
    const list = buildTeamList(null, [therapist({ id: 't1', name: 'Dr A', userId: 'u1' })]);
    expect(list).toHaveLength(1);
    expect(list[0].member).toBeNull();
    expect(list[0].therapist?.userId).toBe('u1');
  });

  it('matches roster to member by display name when userId has not synced locally', () => {
    const list = buildTeamList(
      [
        {
          userId: 'u1',
          email: 'a@example.com',
          role: 'therapist',
          displayName: 'Dr Aishwarya Rani',
          status: 'active',
          invitedAt: null,
          lastSignInAt: null,
          lastActiveAt: null,
        },
      ],
      [therapist({ id: 't1', name: 'Dr Aishwarya Rani', userId: null })]
    );
    expect(list).toHaveLength(1);
    expect(list[0].member?.userId).toBe('u1');
    expect(list[0].therapist?.id).toBe('t1');
  });
});
