// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PhoneScheduleToolbar, PhoneStatusLine } from './PhoneScheduleToolbar';
import { BookFab } from './BookFab';
import { TherapistFilter } from './TherapistFilter';
import { MiniCalendarStrip } from '@/components/MiniCalendarStrip';

function setup(overrides: Partial<Parameters<typeof PhoneScheduleToolbar>[0]> = {}) {
  const props = {
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

  it('is one row: therapist filter, Day/3-Day switch and menu — no date headline or Today button', () => {
    setup();
    const root = document.querySelector('[data-phone-toolbar]')!;
    for (const name of ['All therapists', 'Day', '3-Day', 'More']) {
      expect(root).toContainElement(screen.getByRole('button', { name }));
    }
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /today|previous|next/i })).not.toBeInTheDocument();
  });

  it('marks the active view, offers only Day and 3-Day, and reports changes', () => {
    const props = setup();
    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '3-Day' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'List' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3-Day' }));
    expect(props.onViewChange).toHaveBeenCalledWith('3day');
  });
});

describe('PhoneStatusLine', () => {
  afterEach(cleanup);

  it('shows the label and summary, with Today only when away from today', () => {
    const onToday = vi.fn();
    const { rerender } = render(<PhoneStatusLine label="Tue, 20 Oct" summary="Nothing booked yet" onToday={onToday} showToday />);
    expect(screen.getByText('Tue, 20 Oct')).toBeInTheDocument();
    expect(screen.getByText(/Nothing booked yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Today/ }));
    expect(onToday).toHaveBeenCalledTimes(1);
    rerender(<PhoneStatusLine label="Today" summary="2 booked" onToday={onToday} showToday={false} />);
    expect(screen.queryByRole('button', { name: /Today/ })).not.toBeInTheDocument();
  });
});

describe('PhoneStatusLine off note', () => {
  afterEach(cleanup);

  it('shows a tappable "N off · Show" after the summary, and nothing when no one is off', () => {
    const onShowOff = vi.fn();
    render(<PhoneStatusLine label="Today" summary="4 booked" onToday={vi.fn()} showToday={false} offCount={2} onShowOff={onShowOff} />);
    fireEvent.click(screen.getByRole('button', { name: '2 off · Show' }));
    expect(onShowOff).toHaveBeenCalled();
    cleanup();
    render(<PhoneStatusLine label="Today" summary="4 booked" onToday={vi.fn()} showToday={false} offCount={0} onShowOff={onShowOff} />);
    expect(screen.queryByText(/off · Show/)).toBeNull();
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

describe('BookFab scroll behaviour', () => {
  afterEach(cleanup);

  it('hides while scrolling down inside a scroll box and returns on scroll up', () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    // jsdom has no layout: give the box 1000px of content in a 500px view.
    Object.defineProperty(box, 'scrollHeight', { value: 1000 });
    Object.defineProperty(box, 'clientHeight', { value: 500 });
    render(<BookFab onClick={vi.fn()} />);
    const fab = screen.getByLabelText('Book appointment', { selector: 'button' });
    const scrollTo = (top: number) => {
      box.scrollTop = top;
      act(() => {
        box.dispatchEvent(new Event('scroll'));
      });
    };
    scrollTo(10);
    scrollTo(300);
    expect(fab).toHaveAttribute('data-hidden', 'true');
    scrollTo(240);
    expect(fab).not.toHaveAttribute('data-hidden');
    box.remove();
  });

  it('ignores rubber-band overscroll past the bottom (no flicker)', () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    Object.defineProperty(box, 'scrollHeight', { value: 1000 });
    Object.defineProperty(box, 'clientHeight', { value: 500 });
    render(<BookFab onClick={vi.fn()} />);
    const fab = screen.getByLabelText('Book appointment', { selector: 'button' });
    const scrollTo = (top: number) => {
      box.scrollTop = top;
      act(() => {
        box.dispatchEvent(new Event('scroll'));
      });
    };
    scrollTo(300);
    scrollTo(500);
    expect(fab).toHaveAttribute('data-hidden', 'true');
    // The bounce reports 530, then settles back to 500: neither is a scroll up.
    scrollTo(530);
    scrollTo(500);
    expect(fab).toHaveAttribute('data-hidden', 'true');
    box.remove();
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
    [[], 'All therapists'],
    [['t1'], 'Dr Asha'],
    [['t1', 't2'], '2 of 3 therapists'],
  ])('shows the label %j as visible text when showLabel is on', (visibleIds, label) => {
    render(<TherapistFilter therapists={therapists} visibleIds={visibleIds} onToggle={vi.fn()} onShowAll={vi.fn()} showLabel />);
    expect(screen.getByText(label)).toHaveClass('inline');
  });

  it('keeps the label hidden on phones by default (desktop look unchanged)', () => {
    render(<TherapistFilter therapists={therapists} visibleIds={['t1']} onToggle={vi.fn()} onShowAll={vi.fn()} />);
    expect(screen.getAllByText('Dr Asha')[0]).toHaveClass('hidden');
  });

  it('single mode (3-Day) is a one-choice list: the chip shows the pick, a row selects and closes the sheet', () => {
    const onSelect = vi.fn();
    render(
      <TherapistFilter
        therapists={therapists.map((t, i) => ({ ...t, summary: i === 0 ? '5 booked' : 'Nothing booked' }))}
        visibleIds={[]}
        onToggle={vi.fn()}
        onShowAll={vi.fn()}
        showLabel
        sheet
        single={{ selectedId: 't2', onSelect }}
      />
    );
    const chip = screen.getByRole('button', { name: /Dr Ravi/ });
    fireEvent.click(chip);
    expect(screen.getByRole('radio', { name: /Dr Ravi/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('5 booked')).toBeInTheDocument();
    expect(screen.queryByText('Show all')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Dr Asha/ }));
    expect(onSelect).toHaveBeenCalledWith('t1');
    expect(screen.queryByRole('radiogroup')).toBeNull();
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

describe('TherapistFilter bottom sheet (phones)', () => {
  afterEach(cleanup);
  const therapists = [
    { id: 't1', name: 'Dr Asha', color: '#2f6690', summary: '2 booked' },
    { id: 't2', name: 'Dr Ravi', color: '#a6552f', summary: 'Off today' },
  ];

  it('opens a sheet (not a popover) with a row per therapist, summaries, Only, and Done', () => {
    const onToggle = vi.fn();
    const onOnly = vi.fn();
    render(<TherapistFilter therapists={therapists} visibleIds={['t1']} onToggle={onToggle} onShowAll={vi.fn()} onOnly={onOnly} showLabel sheet />);
    expect(screen.queryByText('Show therapists')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Dr Asha/ }));
    expect(screen.getByText('Show therapists')).toBeInTheDocument();
    expect(screen.getByText('2 booked')).toBeInTheDocument();
    expect(screen.getByText('Off today')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Dr Ravi/ }));
    expect(onToggle).toHaveBeenCalledWith('t2');
    fireEvent.click(screen.getByRole('button', { name: 'Only Dr Ravi' }));
    expect(onOnly).toHaveBeenCalledWith('t2');
    expect(screen.queryByText('Show therapists')).not.toBeInTheDocument();
  });

  it('Show all appears only when the list is narrowed, and Done closes the sheet', () => {
    const onShowAll = vi.fn();
    render(<TherapistFilter therapists={therapists} visibleIds={['t1']} onToggle={vi.fn()} onShowAll={onShowAll} showLabel sheet />);
    fireEvent.click(screen.getByRole('button', { name: /Dr Asha/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(onShowAll).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Show therapists')).not.toBeInTheDocument();
    cleanup();
    render(<TherapistFilter therapists={therapists} visibleIds={[]} onToggle={vi.fn()} onShowAll={vi.fn()} showLabel sheet />);
    fireEvent.click(screen.getByRole('button', { name: /All therapists/ }));
    expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument();
  });

  it('without sheet the desktop popover is unchanged', () => {
    render(<TherapistFilter therapists={therapists} visibleIds={[]} onToggle={vi.fn()} onShowAll={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /All therapists/ }));
    expect(screen.getByText('Show therapists')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });
});
