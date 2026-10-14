// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { hasUnsavedWork, useUnsavedWorkProbe } from './unsavedWork';

function Screen({ dirty }: { dirty: boolean }) {
  useUnsavedWorkProbe(() => dirty);
  return null;
}

afterEach(cleanup);

describe('unsaved work registry', () => {
  it('is false with nothing registered', () => {
    expect(hasUnsavedWork()).toBe(false);
  });
  it('reflects the current state of a mounted screen, and forgets it on unmount', () => {
    const { rerender, unmount } = render(<Screen dirty={false} />);
    expect(hasUnsavedWork()).toBe(false);
    rerender(<Screen dirty />);
    expect(hasUnsavedWork()).toBe(true);
    unmount();
    expect(hasUnsavedWork()).toBe(false);
  });
});
