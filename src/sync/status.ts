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
