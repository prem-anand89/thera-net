// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const schedule = vi.fn();
vi.mock('@/sync/engine', () => ({ syncEngine: { schedule: (...a: unknown[]) => schedule(...a) } }));
vi.mock('./signOut', () => ({ signOutSafely: vi.fn() }));

import { PREPARING_ESCAPE_AFTER_MS, PreparingEscape } from './PreparingEscape';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PreparingEscape', () => {
  it('shows nothing at first, then Retry and Sign out after 15 seconds', () => {
    vi.useFakeTimers();
    render(<PreparingEscape error="Network unreachable" />);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(PREPARING_ESCAPE_AFTER_MS);
    });
    expect(screen.getByText(/taking longer than usual \(Network unreachable\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('Retry asks the sync engine to run now', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PreparingEscape />);
    act(() => {
      vi.advanceTimersByTime(PREPARING_ESCAPE_AFTER_MS);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(schedule).toHaveBeenCalledWith(0);
  });
});
