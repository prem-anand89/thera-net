// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OpenDaysStrip } from './OpenDaysStrip';

describe('OpenDaysStrip', () => {
  afterEach(cleanup);

  it('lights the open days, Monday first, and says in words which are closed', () => {
    render(<OpenDaysStrip closedWeekdays={[0]} onChange={vi.fn()} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sun' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('open-days-summary')).toHaveTextContent('Closed on Sun');
  });

  it('tapping an open day closes it, and tapping a closed day opens it, sorted', () => {
    const onChange = vi.fn();
    render(<OpenDaysStrip closedWeekdays={[0, 6]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }));
    expect(onChange).toHaveBeenLastCalledWith([0, 3, 6]);
    fireEvent.click(screen.getByRole('button', { name: 'Sat' }));
    expect(onChange).toHaveBeenLastCalledWith([0]);
  });

  it('reads "Open every day" and joins runs of closed days', () => {
    const { rerender } = render(<OpenDaysStrip closedWeekdays={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId('open-days-summary')).toHaveTextContent('Open every day');
    rerender(<OpenDaysStrip closedWeekdays={[0, 5, 6]} onChange={vi.fn()} />);
    expect(screen.getByTestId('open-days-summary')).toHaveTextContent('Closed on Fri–Sun');
  });

  it('does nothing while disabled', () => {
    const onChange = vi.fn();
    render(<OpenDaysStrip closedWeekdays={[0]} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
