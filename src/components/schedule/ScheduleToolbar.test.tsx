// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScheduleToolbar } from './ScheduleToolbar';

function setup(overrides: Partial<Parameters<typeof ScheduleToolbar>[0]> = {}) {
  const props = {
    mode: 'day' as const,
    weekAvailable: true,
    onModeChange: vi.fn(),
    onStep: vi.fn(),
    onToday: vi.fn(),
    todayDisabled: false,
    headline: { short: '20 Oct', long: 'Tuesday, 20 October' },
    summary: '4 booked',
    filter: <span>filter</span>,
    findTimeActive: false,
    onToggleFindTime: vi.fn(),
    menu: <span>menu</span>,
    ...overrides,
  };
  render(<ScheduleToolbar {...props} />);
  return props;
}

describe('ScheduleToolbar', () => {
  afterEach(cleanup);

  it('lays out controls in the phones\' order: steppers, headline, Today, filter, view switch, Find a time, menu', () => {
    setup();
    const text = document.querySelector('[data-schedule-toolbar]')!.textContent!;
    const order = ['Tuesday, 20 October', 'Today', 'filter', 'Day', 'Week', 'Find a time', 'menu'].map((t) => text.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('disables Today when already there, and steps by day or week', () => {
    const props = setup({ todayDisabled: true });
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(props.onStep).toHaveBeenCalledWith(1);
    cleanup();
    setup({ mode: 'week' });
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
  });

  it('Find a time toggles, shows its state, and is offered in day view only', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Find a time' }));
    expect(props.onToggleFindTime).toHaveBeenCalled();
    cleanup();
    setup({ findTimeActive: true });
    expect(screen.getByRole('button', { name: 'Back to schedule' })).toHaveAttribute('aria-pressed', 'true');
    cleanup();
    setup({ mode: 'week' });
    expect(screen.queryByRole('button', { name: 'Find a time' })).toBeNull();
  });

  it('switching view calls onModeChange', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(props.onModeChange).toHaveBeenCalledWith('week');
  });

  it('shows "N off today · Show" beside the summary only when someone is left out, and Show calls back', () => {
    const props = setup({ offCount: 2, onShowOff: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: '2 off · Show' }));
    expect(props.onShowOff).toHaveBeenCalled();
    cleanup();
    setup({ offCount: 2, offIsToday: true, onShowOff: vi.fn() });
    expect(screen.getByRole('button', { name: '2 off today · Show' })).toBeInTheDocument();
    cleanup();
    setup({ offCount: 0, onShowOff: vi.fn() });
    expect(screen.queryByText(/off.*Show/)).toBeNull();
  });

  it('the headline opens a month calendar when one is provided, and closes it again', () => {
    setup({ monthPicker: (close) => <button type="button" onClick={close}>pick 21</button> });
    expect(screen.queryByRole('dialog', { name: 'Month calendar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pick a date' }));
    expect(screen.getByRole('dialog', { name: 'Month calendar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'pick 21' }));
    expect(screen.queryByRole('dialog', { name: 'Month calendar' })).toBeNull();
  });

  it('without a month picker the headline is plain text', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Pick a date' })).toBeNull();
  });
});
