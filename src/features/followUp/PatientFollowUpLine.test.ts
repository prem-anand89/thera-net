import { describe, expect, it } from 'vitest';
import { followUpLabel } from './PatientFollowUpLine';

describe('followUpLabel', () => {
  it('words each state in plain language', () => {
    expect(followUpLabel('due', 0, '2026-10-30')).toBe('due today');
    expect(followUpLabel('due_soon', 2, '2026-10-30')).toBe('due in 2 days (30/10/26)');
    expect(followUpLabel('due_soon', 1, '2026-10-30')).toContain('due in 1 day');
    expect(followUpLabel('overdue', -3, '2026-10-30')).toBe('overdue by 3 days');
    expect(followUpLabel('missed', -9, '2026-10-30')).toBe('missed (was due 30/10/26)');
    expect(followUpLabel('done', -1, '2026-10-30')).toBe('done (was due 30/10/26)');
    expect(followUpLabel('planned', 9, '2026-10-30')).toBe('planned for 30/10/26');
  });
});
