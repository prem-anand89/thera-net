import { writable, type Writable } from 'svelte/store';

export interface SyncStatus {
  online?: boolean;
  syncing?: boolean;
  pending?: number;
  lastSyncAt?: number;
  error?: string | null;
}

export const syncStatus: Writable<SyncStatus> = writable({ online: true, pending: 0 });

/**
 * Determines if an error is permanent (won't succeed by retrying).
 *
 * Permanent failures:
 * - 42501: RLS policy violation — row ownership won't change on retry
 * - 42703: Column not found — schema mismatch, needs migration
 * - 23514: Check constraint violation — data violates business rules
 *
 * Temporary failures (will retry):
 * - Network errors: fetch failures, timeouts
 * - 503: Service unavailable
 * - Transaction conflicts
 */
export function isPermanentFailure(code: string | null, message: string): boolean {
  if (!code) return false;

  const permanentCodes = new Set([
    '42501', // RLS policy violation
    '42703', // Column not found (schema mismatch)
    '23514', // Check constraint violation
    '23505', // Unique constraint violation
    '23502', // Not null constraint violation
  ]);

  return permanentCodes.has(code) || message.toLowerCase().includes('forbidden');
}
