/**
 * True for a rejection that will never succeed by retrying (an RLS
 * permission denial) — the row's ownership isn't going to change on its
 * own, unlike a network blip or a transient constraint conflict. Shared by
 * SyncEngine (which reverts the local row to server truth for exactly this
 * case, since a normal pull can't — it deliberately skips rows with a
 * pending outbox entry) and SyncBadge (which labels it "won't succeed by
 * retrying" instead of the default "keeps retrying" copy) so the two can't
 * silently drift onto different definitions of "permanent."
 */
export function isPermanentFailure(errorCode: string | undefined, errorMessage: string | undefined): boolean {
  return errorCode === '42501' || /row-level security policy/i.test(errorMessage ?? '');
}

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  /** Outbox entries not yet accepted by the server */
  pending: number;
  lastSyncAt: number | null;
  error: string | null;
}

type Listener = () => void;

class SyncStatusStore {
  private snapshot: SyncStatus = {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    syncing: false,
    pending: 0,
    lastSyncAt: null,
    error: null,
  };
  private listeners = new Set<Listener>();

  get(): SyncStatus {
    return this.snapshot;
  }

  set(partial: Partial<SyncStatus>) {
    this.snapshot = { ...this.snapshot, ...partial };
    this.listeners.forEach((l) => l());
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export const syncStatus = new SyncStatusStore();
