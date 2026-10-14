// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => [] }));
vi.mock('@/lib/db', () => ({ db: { outbox: {} } }));
vi.mock('@/sync/engine', () => ({ NETWORK_UNREACHABLE: 'Network unreachable', syncEngine: { schedule: vi.fn(), discard: vi.fn() } }));

import { SyncBadge, SyncStatusBanners } from './SyncBadge';
import { syncStatus } from '@/sync/status';

describe('SyncBadge truthfulness', () => {
  beforeEach(() => syncStatus.set({ online: true, pending: 0, syncing: false, error: null, lastSuccessAt: Date.now() - 60_000 }));
  afterEach(() => {
    cleanup();
    syncStatus.reset();
  });

  it('says Synced right after a successful sync', () => {
    render(<SyncBadge />);
    expect(screen.getByRole('button', { name: 'Sync: Synced' })).toBeInTheDocument();
  });

  it('does not say Synced when the last sync is over 30 minutes old', () => {
    act(() => syncStatus.set({ lastSuccessAt: Date.now() - 45 * 60_000 }));
    render(<SyncBadge />);
    expect(screen.getByRole('button', { name: 'Sync: Not synced recently' })).toBeInTheDocument();
  });

  it('says Sync issue (not Synced) when the last attempt errored', () => {
    act(() => syncStatus.set({ error: 'boom' }));
    render(<SyncBadge />);
    expect(screen.getByRole('button', { name: 'Sync: Sync issue' })).toBeInTheDocument();
  });

  it('offline banner mentions all changes, not just visits', () => {
    act(() => syncStatus.set({ online: false }));
    render(<SyncStatusBanners />);
    expect(screen.getByText(/Your changes save on this device and sync when you're back online/)).toBeInTheDocument();
  });

  it("says Can't reach the server for a network failure while online", () => {
    act(() => syncStatus.set({ error: 'Network unreachable' }));
    render(<SyncBadge />);
    expect(screen.getByRole('button', { name: "Sync: Can't reach the server" })).toBeInTheDocument();
  });

  it('does not say Synced for a device that never completed a sync', () => {
    vi.useFakeTimers({ now: Date.now() + 5 * 60 * 1000 });
    act(() => syncStatus.set({ lastSuccessAt: undefined }));
    render(<SyncBadge />);
    expect(screen.getByRole('button', { name: 'Sync: Not synced yet' })).toBeInTheDocument();
    vi.useRealTimers();
  });
});
