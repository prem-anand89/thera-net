// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PhoneScheduleToolbar } from './PhoneScheduleToolbar';
import { BookFab } from './BookFab';
import { TherapistFilter } from './TherapistFilter';
import { MiniCalendarStrip } from '@/components/MiniCalendarStrip';

function setup(overrides: Partial<Parameters<typeof PhoneScheduleToolbar>[0]> = {}) {
  const props = {
    month: 'October 2026',
    summary: '3 booked, 1 still to come',
    onToday: vi.fn(),
    todayDisabled: false,
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

  it('is a single row: short month over the summary, then filter, view switch and menu', () => {
    setup({ month: "Oct '26", todayDisabled: true });
    const root = document.querySelector('[data-phone-toolbar]')!;
    expect(root.children).toHaveLength(4);
    expect(screen.getByRole('heading', { name: "Oct '26" })).toBeInTheDocument();
    expect(screen.getByText('3 booked, 1 still to come')).toBeInTheDocument();
    for (const name of ['All therapists', 'Day', 'More']) {
      expect(root).toContainElement(screen.getByRole('button', { name }));
    }
  });

  it('away from today the second line is a Today button instead of the summary', () => {
    const props = setup({ month: "Oct '26", todayDisabled: false });
    expect(screen.queryByText('3 booked, 1 still to come')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Oct '26. Go to today" }));
    expect(props.onToday).toHaveBeenCalled();
  });

  it('has no previous/next date buttons (the week strip navigates)', () => {
    setup();
    expect(screen.queryByRole('button', { name: /previous|next/i })).not.toBeInTheDocument();
  });

  it('marks the active view, offers only Day and 3-Day, and reports changes', () => {
    const props = setup();
    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '3-Day' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'List' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3-Day' }));
    expect(props.onViewChange).toHaveBeenCalledWith('3day');
  });

  it('on today there is no Today button to press', () => {
    setup({ todayDisabled: true });
    expect(screen.queryByRole('button', { name: /today/i })).not.toBeInTheDocument();
  });
});

describe('BookFab', () => {
  afterEach(cleanup);

  it('is a labelled round button that starts a booking', () => {
    const onClick = vi.fn();
    render(<BookFab onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Book appointment' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('TherapistFilter phone chip', () => {
  afterEach(cleanup);
  const therapists = [
    { id: 't1', name: 'Dr Asha', color: '#2f6690' },
    { id: 't2', name: 'Dr Ravi', color: '#a6552f' },
    { id: 't3', name: 'Dr Kiran', color: '#5b7a52' },
  ];

  it.each([
    [[], 'All'],
    [['t1'], 'Asha'],
    [['t1', 't2'], '2 of 3'],
  ])('shows the compact label %j as visible text when showLabel is on', (visibleIds, label) => {
    render(<TherapistFilter therapists={therapists} visibleIds={visibleIds} onToggle={vi.fn()} onShowAll={vi.fn()} showLabel />);
    expect(screen.getByText(label)).toHaveClass('inline');
  });

  it('keeps the label hidden on phones by default (desktop look unchanged)', () => {
    render(<TherapistFilter therapists={therapists} visibleIds={['t1']} onToggle={vi.fn()} onShowAll={vi.fn()} />);
    expect(screen.getAllByText('Dr Asha')[0]).toHaveClass('hidden');
  });
});

describe('MiniCalendarStrip range', () => {
  afterEach(cleanup);

  it('highlights a connected range (3-Day) and only the selected day otherwise', () => {
    const { container, rerender } = render(
      <MiniCalendarStrip selectedDate="2026-10-15" onSelectDate={vi.fn()} appointmentDates={[]} rangeDays={['2026-10-15', '2026-10-16', '2026-10-17']} />
    );
    expect(container.querySelectorAll('[data-in-range]')).toHaveLength(3);
    rerender(<MiniCalendarStrip selectedDate="2026-10-15" onSelectDate={vi.fn()} appointmentDates={[]} />);
    expect(container.querySelectorAll('[data-in-range]')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
  });
});
