// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SectionSaveBar, SwitchRow } from './settingsShared';

afterEach(cleanup);

const bar = (over: Partial<React.ComponentProps<typeof SectionSaveBar>> = {}) => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<SectionSaveBar dirty saved={false} busy={false} onSave={onSave} onCancel={onCancel} error={null} {...over} />);
  return { onSave, onCancel };
};

describe('SectionSaveBar', () => {
  it('says Unsaved, and saves or cancels', () => {
    const { onSave, onCancel } = bar();
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('sticks to the bottom of the screen while its card is in view', () => {
    bar();
    expect(screen.getByTestId('section-save-bar').className).toMatch(/\bsticky\b/);
  });

  it('says Saving… while busy, and Saved ✓ after a save', () => {
    bar({ busy: true });
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
    cleanup();
    bar({ dirty: false, saved: true });
    expect(screen.getByRole('status')).toHaveTextContent('Saved ✓');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows a problem inside the bar, so it is never below the fold', () => {
    bar({ error: 'Enter a valid UPI ID' });
    expect(screen.getByTestId('section-save-bar')).toContainElement(screen.getByRole('alert'));
  });

  it('keeps Save off when the card says it cannot be saved yet', () => {
    bar({ saveDisabled: true });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('SwitchRow', () => {
  it('is a named switch that toggles, and cannot be toggled when disabled', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SwitchRow label="Daily agenda email" hint="One email" checked={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Daily agenda email' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<SwitchRow label="Daily agenda email" checked onChange={onChange} disabled />);
    expect(screen.getByRole('switch', { name: 'Daily agenda email' })).toBeDisabled();
  });
});
