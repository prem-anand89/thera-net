// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PublishToLibraryDialog } from './PublishToLibraryDialog';

afterEach(cleanup);

const show = (over: Partial<Parameters<typeof PublishToLibraryDialog>[0]> = {}) => {
  const onConfirm = vi.fn();
  render(<PublishToLibraryDialog open count={3} hasPictures onConfirm={onConfirm} onCancel={vi.fn()} {...over} />);
  return onConfirm;
};

describe('PublishToLibraryDialog', () => {
  it('needs a source and the permission tick when there are pictures', async () => {
    const user = userEvent.setup();
    const onConfirm = show();
    const go = screen.getByRole('button', { name: 'Add to library' });
    expect(go).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Where do the pictures come from?'), 'own_photography');
    expect(go).toBeDisabled();
    await user.click(screen.getByLabelText('I have the right to share these pictures with all TheraNet clinics.'));
    expect(go).toBeEnabled();
    await user.click(go);
    expect(onConfirm).toHaveBeenCalledWith({ imageSource: 'own_photography', imageNote: null });
  });

  it('asks for the movements check only for AI-generated pictures', async () => {
    const user = userEvent.setup();
    show();
    expect(screen.queryByLabelText('I have checked that the movements are shown correctly.')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Where do the pictures come from?'), 'ai_generated');
    expect(screen.getByLabelText('I have checked that the movements are shown correctly.')).toBeInTheDocument();
  });

  it('with no pictures there is nothing to declare and it confirms with no source', async () => {
    const user = userEvent.setup();
    const onConfirm = show({ hasPictures: false, count: 1 });
    expect(screen.queryByLabelText('Where do the pictures come from?')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add to library' }));
    expect(onConfirm).toHaveBeenCalledWith({ imageSource: null, imageNote: null });
  });

  it('says Update when the exercise is already in the library', () => {
    show({ update: true, count: 1 });
    expect(screen.getByRole('dialog', { name: 'Update in TheraNet Library?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update library' })).toBeInTheDocument();
  });
});
