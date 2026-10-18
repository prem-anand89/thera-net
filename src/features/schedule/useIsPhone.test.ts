// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { PHONE_MEDIA_QUERY, useIsPhone } from './useIsPhone';

describe('useIsPhone', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('matches (max-width: 46.49rem)', () => {
    expect(PHONE_MEDIA_QUERY).toBe('(max-width: 46.49rem)');
  });

  it('tolerates missing window.matchMedia and returns false', () => {
    // @ts-expect-error test missing matchMedia
    window.matchMedia = undefined;
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);
  });

  it('initializes true when matchMedia matches', () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === PHONE_MEDIA_QUERY,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(true);
  });

  it('updates state when media query change event fires', () => {
    let listener: ((e: MediaQueryListEvent) => void) | null = null;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn((event, fn) => {
        if (event === 'change') listener = fn;
      }),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);

    act(() => {
      listener?.({ matches: true } as MediaQueryListEvent);
    });

    expect(result.current).toBe(true);
  });
});
