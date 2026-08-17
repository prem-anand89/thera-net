import { describe, it, expect } from 'vitest';
import { isPermanentFailure } from '../status';

describe('isPermanentFailure', () => {
  it('classifies RLS policy violations as permanent', () => {
    expect(isPermanentFailure('42501', 'permission denied for schema public')).toBe(true);
  });

  it('classifies schema mismatches (missing columns) as permanent', () => {
    expect(isPermanentFailure('42703', 'column "pending_payment_note" does not exist')).toBe(
      true
    );
  });

  it('classifies constraint violations as permanent', () => {
    expect(isPermanentFailure('23514', 'new row violates check constraint')).toBe(true);
    expect(isPermanentFailure('23505', 'duplicate key value violates unique constraint')).toBe(
      true
    );
    expect(isPermanentFailure('23502', 'null value in column violates not-null constraint')).toBe(
      true
    );
  });

  it('classifies network errors as temporary', () => {
    expect(isPermanentFailure('NETWORK', 'fetch failed')).toBe(false);
    expect(isPermanentFailure('503', 'Service Unavailable')).toBe(false);
  });

  it('handles null code gracefully', () => {
    expect(isPermanentFailure(null, 'some error')).toBe(false);
  });

  it('detects "forbidden" case-insensitively', () => {
    expect(isPermanentFailure('403', 'Forbidden')).toBe(true);
    expect(isPermanentFailure('403', 'FORBIDDEN')).toBe(true);
  });
});
