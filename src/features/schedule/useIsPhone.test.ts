// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsPhone, PHONE_MEDIA_QUERY } from './useIsPhone';

describe('useIsPhone', () => {
  let listeners: ((e: MediaQueryListEvent) => void)[] = [];
  let currentMatches = false;

  beforeEach(() => {
    listeners = [];
    currentMatches = false;

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: currentMatches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_event: string, cb: (e: MediaQueryListEvent) => void) => {
        listeners.push(cb);
      }),
      removeEventListener: vi.fn((_event: string, cb: (e: MediaQueryListEvent) => void) => {
        listeners = listeners.filter((l) => l !== cb);
      }),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queries the exact Tailwind tab breakpoint', () => {
    renderHook(() => useIsPhone());
    expect(window.matchMedia).toHaveBeenCalledWith(PHONE_MEDIA_QUERY);
    expect(PHONE_MEDIA_QUERY).toBe('(max-width: 46.49rem)');
  });

  it('returns true when media query matches', () => {
    currentMatches = true;
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(true);
  });

  it('returns false when media query does not match', () => {
    currentMatches = false;
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);
  });

  it('updates state dynamically when matchMedia change event fires', () => {
    currentMatches = false;
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);

    act(() => {
      listeners.forEach((cb) =>
        cb({ matches: true, media: PHONE_MEDIA_QUERY } as MediaQueryListEvent)
      );
    });

    expect(result.current).toBe(true);
  });

  it('tolerates environment without matchMedia', () => {
    // @ts-expect-error test environment override
    delete window.matchMedia;

    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);
  });
});
