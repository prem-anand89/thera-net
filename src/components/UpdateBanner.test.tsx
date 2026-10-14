// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/registerServiceWorker', () => ({ applyUpdateNow: vi.fn() }));
vi.mock('@/sync/status', () => ({
  syncStatus: {
    get: () => ({ pending: 0 }),
    subscribe: (cb: (s: { pending: number }) => void) => {
      cb({ pending: 3 });
      return () => {};
    },
  },
}));

import { applyUpdateNow } from '@/app/registerServiceWorker';
import { STICKY_AFTER_MS, updateStore } from '@/app/updateStore';
import { UpdateBanner } from './UpdateBanner';

vi.stubGlobal('__APP_VERSION__', '2.1.0');
vi.stubGlobal('__APP_BUILD__', 'abc1234');

describe('UpdateBanner', () => {
  beforeEach(() => updateStore.reset());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders nothing when up to date', () => {
    const { container } = render(<UpdateBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the version and unsynced count, and Refresh applies the update', async () => {
    updateStore.markWaiting();
    render(<UpdateBanner />);
    expect(screen.getByText('A new version is available')).toBeInTheDocument();
    expect(screen.getByText(/v2\.1\.0 · abc1234/)).toBeInTheDocument();
    expect(screen.getByText(/3 unsynced changes will sync first/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(applyUpdateNow).toHaveBeenCalledTimes(1);
  });

  it('Later hides it', async () => {
    updateStore.markWaiting();
    render(<UpdateBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('A new version is available')).not.toBeInTheDocument();
  });

  it('drops Later once the update has waited long enough', () => {
    vi.useFakeTimers();
    updateStore.markWaiting(Date.now() - STICKY_AFTER_MS - 1000);
    render(<UpdateBanner />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('A new version is available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Later' })).not.toBeInTheDocument();
  });

  it('shows Updating… while applying', () => {
    updateStore.markWaiting();
    updateStore.setApplying(true);
    render(<UpdateBanner />);
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
  });
});
