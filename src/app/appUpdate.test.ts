// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStaleChunkError, reloadForNewVersion } from './appUpdate';

describe('isStaleChunkError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/Ledger-abc.js',
    'Importing a module script failed.',
    'error loading dynamically imported module',
    'Failed to load module script: Expected a JavaScript module script',
    'Load failed', // Safari/WebKit's generic fetch-rejection wording for the same failure
  ])('matches %s', (msg) => {
    expect(isStaleChunkError(new Error(msg))).toBe(true);
  });

  it('ignores ordinary errors', () => {
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('does not match "Load failed" as a substring of an unrelated message', () => {
    expect(isStaleChunkError(new Error('Load failed to parse the response body'))).toBe(false);
  });
});

describe('reloadForNewVersion', () => {
  const reload = vi.fn();
  const assign = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    reload.mockReset();
    assign.mockReset();
    vi.stubGlobal('location', { ...window.location, reload, assign });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reloads once, then refuses inside the cooldown', () => {
    expect(reloadForNewVersion()).toBe(true);
    expect(reloadForNewVersion()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('allows another reload after the cooldown (later deploy, same tab)', () => {
    vi.useFakeTimers();
    expect(reloadForNewVersion()).toBe(true);
    vi.advanceTimersByTime(61_000);
    expect(reloadForNewVersion()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('hard-navigates to the target when given one', () => {
    expect(reloadForNewVersion('/ledger?tab=visits')).toBe(true);
    expect(assign).toHaveBeenCalledWith('/ledger?tab=visits');
    expect(reload).not.toHaveBeenCalled();
  });
});
