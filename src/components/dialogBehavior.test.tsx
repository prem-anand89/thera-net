// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useDialogBehavior, wrapFocusTarget } from './dialogBehavior';

function Demo({ onClose }: { onClose: () => void }) {
  const ref = useDialogBehavior<HTMLDivElement>(true, onClose);
  return (
    <div ref={ref} role="dialog">
      <button type="button">first</button>
      <button type="button">last</button>
    </div>
  );
}

function Nested({ outerClose, innerClose }: { outerClose: () => void; innerClose: () => void }) {
  const [inner, setInner] = useState(true);
  return (
    <>
      <Demo onClose={outerClose} />
      {inner && (
        <Demo
          onClose={() => {
            innerClose();
            setInner(false);
          }}
        />
      )}
    </>
  );
}

afterEach(cleanup);

describe('useDialogBehavior', () => {
  it('moves focus into the dialog on open', () => {
    render(<Demo onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
  });

  it('Escape closes it', () => {
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape only closes the topmost of two stacked dialogs', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(<Nested outerClose={outer} innerClose={inner} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('returns focus to the opener when closed', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<Demo onClose={() => {}} />);
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});

describe('wrapFocusTarget', () => {
  const a = document.createElement('button');
  const b = document.createElement('button');
  it('wraps Tab from the last to the first, and Shift+Tab from the first to the last', () => {
    expect(wrapFocusTarget([a, b], b, false)).toBe(a);
    expect(wrapFocusTarget([a, b], a, true)).toBe(b);
    expect(wrapFocusTarget([a, b], a, false)).toBeNull();
    expect(wrapFocusTarget([], a, false)).toBeNull();
  });
});
