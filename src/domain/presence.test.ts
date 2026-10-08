import { describe, expect, it } from 'vitest';
import { lastActivePingKey, shouldPingLastActive } from './presence';

describe('lastActivePingKey', () => {
  it('namespaces by both clinic and user, so a shared device keeps each user distinct', () => {
    expect(lastActivePingKey('c1', 'u1')).toBe('lastActivePinged:c1:u1');
    expect(lastActivePingKey('c1', 'u1')).not.toBe(lastActivePingKey('c1', 'u2'));
    expect(lastActivePingKey('c1', 'u1')).not.toBe(lastActivePingKey('c2', 'u1'));
  });
});

describe('shouldPingLastActive', () => {
  it('pings when there is no stored date yet', () => {
    expect(shouldPingLastActive(undefined, '2026-10-08')).toBe(true);
  });
  it('pings when the stored date is stale', () => {
    expect(shouldPingLastActive('2026-10-07', '2026-10-08')).toBe(true);
  });
  it('stays silent once already pinged today', () => {
    expect(shouldPingLastActive('2026-10-08', '2026-10-08')).toBe(false);
  });
});
