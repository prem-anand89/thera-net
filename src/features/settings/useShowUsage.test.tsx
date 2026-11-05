// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useShowUsage } from './useShowUsage';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('useShowUsage', () => {
  it('is on by default and remembers switching it off on this device, per list', () => {
    const a = renderHook(() => useShowUsage('services'));
    expect(a.result.current[0]).toBe(true);
    act(() => a.result.current[1](false));
    expect(a.result.current[0]).toBe(false);
    // A reload (a fresh hook) keeps it; the treatments list keeps its own choice.
    expect(renderHook(() => useShowUsage('services')).result.current[0]).toBe(false);
    expect(renderHook(() => useShowUsage('treatments')).result.current[0]).toBe(true);
  });

  it('still works for this visit when storage is blocked, and starts on', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const h = renderHook(() => useShowUsage('services'));
    expect(h.result.current[0]).toBe(true);
    act(() => h.result.current[1](false));
    expect(h.result.current[0]).toBe(false);
  });
});
