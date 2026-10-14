// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NoticeHost } from './NoticeHost';
import { askConfirm, notify, noticeStore } from '@/lib/notify';

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

  it('a second queued confirm starts with an empty type-to-confirm box', async () => {
    render(<NoticeHost />);
    act(() => {
      void askConfirm({ title: 'Delete A', message: 'm', typeToConfirm: { placeholder: 'A', isMatch: (t) => t === 'A' } });
      void askConfirm({ title: 'Delete B', message: 'm', typeToConfirm: { placeholder: 'B', isMatch: (t) => t === 'B' } });
    });
    await userEvent.type(screen.getByPlaceholderText('A'), 'A');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByText('Delete B')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('B')).toHaveValue('');
  });

  it('counts a repeated message instead of stacking copies, and caps how many show', () => {
    render(<NoticeHost />);
    act(() => {
      notify.error('Could not save');
      notify.error('Could not save');
      notify.error('Could not save');
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('×3')).toBeInTheDocument();
    act(() => {
      notify.error('A');
      notify.error('B');
      notify.error('C');
    });
    expect(screen.getAllByRole('alert')).toHaveLength(3); // oldest dropped
    expect(screen.queryByText(/Could not save/)).not.toBeInTheDocument();
  });

  it('pauses auto-dismiss while hovered', () => {
    vi.useFakeTimers();
    render(<NoticeHost />);
    act(() => notify.info('Saved'));
    fireEvent.mouseEnter(screen.getByRole('status'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByRole('status'));
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
