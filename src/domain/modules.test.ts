import { describe, expect, it } from 'vitest';
import { canUseModule } from './modules';
import type { ClinicModuleSetting } from './types';

function setting(overrides: Partial<ClinicModuleSetting> = {}): ClinicModuleSetting {
  return {
    id: 's1',
    clinicId: 'c1',
    moduleKey: 'face_scale',
    enabled: true,
    allowedRoles: ['admin', 'staff'],
    config: {},
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('canUseModule', () => {
  it('allows a permitted role on an enabled module', () => {
    expect(canUseModule([setting()], 'face_scale', 'staff')).toBe(true);
    expect(canUseModule([setting()], 'face_scale', 'admin')).toBe(true);
  });

  it('denies when the module is disabled, even for an otherwise-permitted role', () => {
    expect(canUseModule([setting({ enabled: false })], 'face_scale', 'admin')).toBe(false);
  });

  it('denies when the role is not in allowedRoles', () => {
    const staffOnly = setting({ allowedRoles: ['staff'] });
    expect(canUseModule([staffOnly], 'face_scale', 'admin')).toBe(false);
    expect(canUseModule([staffOnly], 'face_scale', 'staff')).toBe(true);
  });

  it('fails closed when no role is known (e.g. membership not yet synced)', () => {
    expect(canUseModule([setting()], 'face_scale', null)).toBe(false);
  });

  it('fails closed when no settings row exists for the module at all', () => {
    expect(canUseModule([], 'face_scale', 'admin')).toBe(false);
    expect(canUseModule(undefined, 'face_scale', 'admin')).toBe(false);
  });

  it('only matches the requested moduleKey, not other configured modules', () => {
    const facialPalsyOnly = setting({ moduleKey: 'facial_palsy' });
    expect(canUseModule([facialPalsyOnly], 'face_scale', 'admin')).toBe(false);
    expect(canUseModule([facialPalsyOnly], 'facial_palsy', 'admin')).toBe(true);
  });
});
