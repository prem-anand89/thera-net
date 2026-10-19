// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PhoneScheduleToolbar } from './PhoneScheduleToolbar';

function setup(overrides: Partial<Parameters<typeof PhoneScheduleToolbar>[0]> = {}) {
  const props = {
    title: 'Wed, 30 Oct',
    summary: '3 booked',
    prevLabel: 'Previous day',
    nextLabel: 'Next day',
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onToday: vi.fn(),
    todayDisabled: false,
    calendarOpen: false,
    onToggleCalendar: vi.fn(),
    view: 'day' as const,
    onViewChange: vi.fn(),
    filter: <button type="button">All therapists</button>,
    menu: <button type="button">More</button>,
    ...overrides,
  };
  render(<PhoneScheduleToolbar {...props} />);
  return props;
}

describe('PhoneScheduleToolbar', () => {
  afterEach(cleanup);

  it('puts date navigation and the controls on separate rows', () => {
    setup();
    const root = document.querySelector('[data-phone-toolbar]')!;
    const rows = root.children;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContainElement(screen.getByRole('button', { name: 'Previous day' }));
    expect(rows[0]).toContainElement(screen.getByRole('button', { name: 'Today' }));
    expect(rows[1]).toContainElement(screen.getByRole('button', { name: 'All therapists' }));
    expect(rows[1]).toContainElement(screen.getByRole('button', { name: 'Day' }));
  });

  it('marks the active view and reports changes', () => {
    const props = setup();
    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '3-Day' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'List' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3-Day' }));
    expect(props.onViewChange).toHaveBeenCalledWith('3day');
  });

  it('title toggles the calendar; navigation and Today fire; Today can be disabled', () => {
    const props = setup({ todayDisabled: true });
    fireEvent.click(screen.getByRole('button', { name: /Wed, 30 Oct/ }));
    expect(props.onToggleCalendar).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(props.onNext).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
  });
});
