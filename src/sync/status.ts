/**
 * Sync status store and error classification.
 *
 * Determines which server errors are permanent (won't retry) vs temporary (retryable).
 */

export interface SyncStatus {
  online?: boolean;
  syncing?: boolean;
  pending?: number;
  lastSyncAt?: number;
  error?: string | null;
}

// Simple in-memory store without external dependencies. Module-lifetime, not
// per-session — on a shared device where a second account signs in without a
// full page reload, an unreset `lastSyncAt` from the PREVIOUS account would
// still read as "this account's sync has settled," since Shell.tsx uses it
// as exactly that signal (see the zero-clinics gate) to decide whether it's
// safe to show CreateClinicForm instead of the new account's real clinics
// still being pulled — reintroducing the duplicate-clinic race a prior fix
// was meant to close. `reset()` (called from Shell.tsx's sign-out cleanup,
// alongside the Dexie clears) puts it back to first-launch state so the next
// account starts from "not yet synced," not the last account's stale answer.
const INITIAL_STATUS: SyncStatus = { online: true, pending: 0 };
let currentStatus: SyncStatus = { ...INITIAL_STATUS };
const subscribers = new Set<(status: SyncStatus) => void>();

export const syncStatus = {
  subscribe(callback: (status: SyncStatus) => void) {
    subscribers.add(callback);
    callback(currentStatus);
    return () => subscribers.delete(callback);
  },
  set(newStatus: Partial<SyncStatus>) {
    currentStatus = { ...currentStatus, ...newStatus };
    subscribers.forEach((cb) => cb(currentStatus));
  },
  get() {
    return currentStatus;
  },
  reset() {
    currentStatus = { ...INITIAL_STATUS, online: navigator.onLine };
    subscribers.forEach((cb) => cb(currentStatus));
  },
};

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
