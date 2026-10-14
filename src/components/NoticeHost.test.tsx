// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NoticeHost } from './NoticeHost';
import { askConfirm, notify, noticeStore } from './notify';

afterEach(() => {
  cleanup();
  act(() => noticeStore.reset());
});

describe('NoticeHost', () => {
  it('shows an error notice as an alert and lets the user dismiss it', async () => {
    render(<NoticeHost />);
    act(() => notify.error('Could not save'));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows info as a status', () => {
    render(<NoticeHost />);
    act(() => notify.info('Submitted'));
    expect(screen.getByRole('status')).toHaveTextContent('Submitted');
  });

  it('askConfirm resolves true on confirm and false on cancel', async () => {
    render(<NoticeHost />);
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => {
      answer = askConfirm({ title: 'Delete this visit?', message: 'Gone for good.', confirmLabel: 'Delete', destructive: true });
    });
    expect(screen.getByText('Delete this visit?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await answer).toBe(true);

    act(() => {
      answer = askConfirm({ title: 'Again?', message: 'm' });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await answer).toBe(false);
  });
});
