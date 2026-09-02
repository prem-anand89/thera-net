import { describe, it, expect } from 'vitest';
import { isPermanentFailure, syncStatus } from '../status';

describe('isPermanentFailure', () => {
  it('classifies RLS policy violations as permanent', () => {
    expect(isPermanentFailure('42501', 'permission denied for schema public')).toBe(true);
  });

  it('classifies schema mismatches (missing columns) as permanent', () => {
    expect(isPermanentFailure('42703', 'column "pending_payment_note" does not exist')).toBe(true);
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

describe('syncStatus.reset', () => {
  it("clears a previous account's lastSyncAt/error/pending back to first-launch state", () => {
    // Simulates one account's session leaving behind "sync has settled"
    // state that a second account signing in on the same device (no full
    // page reload) would otherwise inherit.
    syncStatus.set({ lastSyncAt: Date.now(), pending: 3, error: 'boom', syncing: true });
    expect(syncStatus.get().lastSyncAt).toBeDefined();

    syncStatus.reset();

    const status = syncStatus.get();
    expect(status.lastSyncAt).toBeUndefined();
    expect(status.pending).toBe(0);
    expect(status.error).toBeUndefined();
    expect(status.syncing).toBeUndefined();
  });

  it('notifies subscribers with the reset state', () => {
    syncStatus.set({ lastSyncAt: Date.now() });
    let seen: ReturnType<typeof syncStatus.get> | undefined;
    const unsubscribe = syncStatus.subscribe((s) => {
      seen = s;
    });
    syncStatus.reset();
    expect(seen?.lastSyncAt).toBeUndefined();
    unsubscribe();
  });
});
