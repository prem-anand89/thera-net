import { describe, expect, it } from 'vitest';
import { isPermanentFailure } from './status';

describe('isPermanentFailure', () => {
  it('is permanent for the 42501 Postgrest code, regardless of message wording', () => {
    expect(isPermanentFailure('42501', 'permission denied for table visits')).toBe(true);
  });

  it('is permanent when the message matches the RLS rejection text, even without a code', () => {
    expect(
      isPermanentFailure(undefined, 'new row violates row-level security policy (USING expression) for table "visits"')
    ).toBe(true);
  });

  it('is not permanent for an unrelated error code or message', () => {
    expect(isPermanentFailure('23505', 'duplicate key value violates unique constraint')).toBe(false);
    expect(isPermanentFailure(undefined, 'Failed to fetch')).toBe(false);
  });

  it('is not permanent when both code and message are absent', () => {
    expect(isPermanentFailure(undefined, undefined)).toBe(false);
  });
});
