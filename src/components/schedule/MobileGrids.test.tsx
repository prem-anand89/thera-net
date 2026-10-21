// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
import { localDateTime } from '@/domain/schedule';
import type { GridTherapist } from './TimeGrid';
import { MobileDayGrid, MobileThreeDayGrid } from './MobileGrids';

const OPEN = { closed: false, kind: null, label: null } as const;

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: 'a1', clinicId: 'c1', patientId: null, patientName: 'Priya', patientPhone: '1',
    therapistId: 't1', scheduledAt: localDateTime('2026-10-01', '10:00').toISOString(),
    durationMinutes: 60, status: 'confirmed', requestId: null, visitId: null,
    rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '',
    ...overrides,
  };
}

const therapists: GridTherapist[] = [
  { id: 't1', name: 'Dr Asha', color: '#468adb' },
  { id: 't2', name: 'Dr Ravi', color: '#ee7c4e' },
];

type DayProps = Parameters<typeof MobileDayGrid>[0];

function dayProps(overrides: Partial<DayProps> = {}): DayProps {
  return {
    date: '2026-10-01',
    today: '2026-10-01',
    nowMinutes: 9 * 60 + 35,
    therapists,
    appointments: [appointment({})],
    hours: { startHour: 9, endHour: 13 },
    slotMinutes: 30,
    closed: OPEN,
    colorFor: () => '#468adb',
    reasonFor: () => 'Lumbar strain',
    selectedId: null,
    onSelect: vi.fn(),
    canBookFor: () => true,
    onBook: vi.fn(),
    summaryFor: () => ({ text: 'None', ratio: null }),
    ...overrides,
  };
}

function setColumnWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}),
  });
}

describe('MobileDayGrid', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it.each([
    [180, 'full', true, true],
    [130, 'medium', false, true],
    [90, 'compact', false, false],
  ])('at %ipx a column shows %s detail', (width, _name, showsReason, showsTime) => {
    setColumnWidth(width);
    // Compact blocks 45+ minutes tall now also show the start time (covered in the 3-Day tests), so the
    // compact case uses a short block to keep checking the bare minimum.
    render(<MobileDayGrid {...dayProps({ appointments: [appointment({ durationMinutes: width === 90 ? 30 : 60 })] })} />);
    const block = screen.getByRole('button', { name: /Priya/ });
    expect(block).toHaveTextContent('Priya');
    if (showsReason) expect(block).toHaveTextContent('Lumbar strain');
    else expect(block).not.toHaveTextContent('Lumbar strain');
    if (showsTime) expect(block).toHaveTextContent('10:00 AM');
    else expect(block).not.toHaveTextContent('10:00 AM');
  });

  it('keeps a free slot at least 44px tall even for 15-minute slots', () => {
    render(<MobileDayGrid {...dayProps({ slotMinutes: 15 })} />);
    const slot = screen.getByRole('button', { name: 'Book Dr Ravi at 11:00 AM' });
    expect(parseFloat(slot.style.height) + 2).toBeGreaterThanOrEqual(44);
  });

  it('tints free time so it is visible without hovering', () => {
    render(<MobileDayGrid {...dayProps()} />);
    expect(screen.getByRole('button', { name: 'Book Dr Ravi at 11:00 AM' }).className).toContain('bg-[var(--moss-light)]/40');
  });

  it('draws the Now line and a time badge on today only', () => {
    const { container, rerender } = render(<MobileDayGrid {...dayProps()} />);
    expect(container.querySelectorAll('[data-now-line]')).toHaveLength(2);
    expect(container.querySelector('[data-now-badge]')).toHaveTextContent('9:35AM');
    rerender(<MobileDayGrid {...dayProps({ today: '2026-09-30' })} />);
    expect(container.querySelector('[data-now-line]')).toBeNull();
    expect(container.querySelector('[data-now-badge]')).toBeNull();
  });

  it('free time is empty on phones: tinted, tappable, and contains no text', () => {
    render(<MobileDayGrid {...dayProps()} />);
    const slot = screen.getByRole('button', { name: 'Book Dr Ravi at 11:00 AM' });
    expect(slot.className).toContain('bg-[var(--moss-light)]/40');
    expect(slot.textContent).toBe('');
  });

  it('three or more therapist columns show first names in the header (no "Dr"), with the full name as tooltip', () => {
    const three: GridTherapist[] = [
      { id: 't1', name: 'Dr Shravya Reddy', color: '#468adb' },
      { id: 't2', name: 'Dr Shriya Gupta', color: '#ee7c4e' },
      { id: 't3', name: 'Stella Baptist', color: '#5b8f5b' },
    ];
    const { container } = render(<MobileDayGrid {...dayProps({ therapists: three, appointments: [] })} />);
    const headers = [...container.querySelectorAll('[data-grid-header] p[title]')];
    expect(headers.map((h) => h.textContent)).toEqual(['Shravya', 'Shriya', 'Stella']);
    expect(headers[0]).toHaveAttribute('title', 'Dr Shravya Reddy');
    cleanup();
    const two = render(<MobileDayGrid {...dayProps()} />);
    expect(two.container.querySelector('[data-grid-header] p[title]')).toHaveTextContent('Dr Asha');
  });

  it('one therapist is one wide column with an in-column hour rail instead of an axis column', () => {
    const { container } = render(<MobileDayGrid {...dayProps({ therapists: [therapists[0]] })} />);
    expect(document.querySelectorAll('[data-grid-header]')).toHaveLength(1);
    expect(container.querySelector('[data-rail]')).not.toBeNull();
    // Hour labels read "9 AM" and live inside the column.
    expect(screen.getAllByText('AM').length).toBeGreaterThan(0);
    // Several therapists keep the separate axis and no rail.
    cleanup();
    const multi = render(<MobileDayGrid {...dayProps()} />);
    expect(multi.container.querySelector('[data-rail]')).toBeNull();
  });

  it('one therapist uses the denser scale: 80px per hour, a 30-minute block is 40px', () => {
    render(<MobileDayGrid {...dayProps({ therapists: [therapists[0]], appointments: [appointment({ durationMinutes: 30 })] })} />);
    const block = screen.getByRole('button', { name: /Priya/ });
    expect(parseFloat(block.style.height) + 1).toBeCloseTo(40, 0);
  });

  it('cards show name and time, then the reason, even on a 30-minute block (two lines)', () => {
    render(
      <MobileDayGrid
        {...dayProps({
          therapists: [therapists[0]],
          appointments: [
            appointment({ id: 'long', patientName: 'Long Visit', durationMinutes: 60 }),
            appointment({ id: 'short', patientName: 'Short Visit', durationMinutes: 30, scheduledAt: localDateTime('2026-10-01', '12:00').toISOString() }),
          ],
        })}
      />
    );
    for (const name of [/Long Visit/, /Short Visit/]) {
      const card = screen.getByRole('button', { name });
      expect(card).toHaveTextContent('Lumbar strain');
    }
    expect(screen.getByRole('button', { name: /Short Visit/ })).toHaveTextContent('12:00–12:30');
  });

  it('fades appointments that ended before now (today) and not later ones', () => {
    render(
      <MobileDayGrid
        {...dayProps({
          nowMinutes: 11 * 60,
          therapists: [therapists[0]],
          appointments: [
            appointment({ id: 'past', patientName: 'Past One', scheduledAt: localDateTime('2026-10-01', '09:00').toISOString() }),
            appointment({ id: 'next', patientName: 'Next One', scheduledAt: localDateTime('2026-10-01', '12:00').toISOString() }),
          ],
        })}
      />
    );
    expect(screen.getByRole('button', { name: /Past One/ }).className).toContain('opacity-75');
    expect(screen.getByRole('button', { name: /Next One/ }).className).not.toContain('opacity-75');
  });

  it('draws the Now line thin and translucent so it never hides text', () => {
    const { container } = render(<MobileDayGrid {...dayProps({ therapists: [therapists[0]] })} />);
    const line = container.querySelector('[data-now-line]')!;
    expect(line.className).toContain('border-t ');
    expect(line.className).not.toContain('border-t-2');
    expect(line.className).toContain('/55');
  });

  it('colleague column: header says view only, no reason or flags, no free slots to book', () => {
    setColumnWidth(180);
    render(
      <MobileDayGrid
        {...dayProps({
          appointments: [appointment({ therapistId: 't2', patientName: 'Kiran' })],
          canBookFor: (id) => id === 't1',
        })}
      />
    );
    expect(screen.getByText('view only')).toBeInTheDocument();
    const block = screen.getByRole('button', { name: /Kiran/ });
    expect(block).not.toHaveTextContent('Lumbar strain');
    expect(screen.queryByRole('button', { name: /Book Dr Ravi/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Book Dr Asha at 11:00 AM' })).toBeInTheDocument();
  });
});

describe('MobileThreeDayGrid', () => {
  afterEach(cleanup);

  const days = ['2026-10-01', '2026-10-02', '2026-10-03'];
  type WeekProps = Parameters<typeof MobileThreeDayGrid>[0];
  const weekProps = (overrides: Partial<WeekProps> = {}): WeekProps => ({
    days,
    today: '2026-10-01',
    nowMinutes: 600,
    appointments: [appointment({})],
    hours: { startHour: 9, endHour: 13 },
    slotMinutes: 30,
    closedFor: () => OPEN,
    colorFor: () => '#468adb',
    selectedId: null,
    onSelect: vi.fn(),
    onBook: vi.fn(),
    onOpenDay: vi.fn(),
    ...overrides,
  });

  it('day headers show up to three load dots instead of a bare count', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) =>
      appointment({ id, scheduledAt: localDateTime('2026-10-02', `${String(9 + i).padStart(2, '0')}:00`).toISOString(), durationMinutes: 30 })
    );
    const { container } = render(<MobileThreeDayGrid {...weekProps({ appointments: [appointment({}), ...many] })} />);
    const dots = [...container.querySelectorAll('[data-load-dots]')].map((el) => el.children.length);
    expect(dots).toEqual([1, 3, 0]);
  });

  it('a compact-width block that is 45+ minutes tall still shows its start time', () => {
    setColumnWidth(100);
    render(<MobileThreeDayGrid {...weekProps({ appointments: [appointment({ durationMinutes: 45 })] })} />);
    expect(screen.getByRole('button', { name: /Priya/ })).toHaveTextContent('10:00 AM');
    cleanup();
    render(<MobileThreeDayGrid {...weekProps({ appointments: [appointment({ durationMinutes: 30 })] })} />);
    expect(screen.getByRole('button', { name: /Priya/ })).not.toHaveTextContent('10:00 AM');
  });

  it('shows three date columns, Now only in today, and header taps open the day', () => {
    const props = weekProps();
    const { container } = render(<MobileThreeDayGrid {...props} />);
    expect(container.querySelectorAll('[data-grid-header]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-now-line]')).toHaveLength(1);
    screen.getByRole('button', { name: 'Open 2026-10-02 in day view' }).click();
    expect(props.onOpenDay).toHaveBeenCalledWith('2026-10-02');
  });

  it('a colleague 3-day view offers no booking', () => {
    render(<MobileThreeDayGrid {...weekProps({ isColleague: true })} />);
    expect(screen.queryByRole('button', { name: /^Book / })).not.toBeInTheDocument();
  });

  it('single-column Day marks half hours with a faint dashed line (not the multi-therapist grid)', () => {
    const { container } = render(<MobileDayGrid {...dayProps({ therapists: [therapists[0]], appointments: [] })} />);
    expect(container.querySelectorAll('[data-half-hour]').length).toBeGreaterThan(0);
    cleanup();
    const multi = render(<MobileDayGrid {...dayProps()} />);
    expect(multi.container.querySelector('[data-half-hour]')).toBeNull();
  });

  it('up to three columns scroll with the page; a wider grid keeps its own scroll box', () => {
    const { container } = render(<MobileDayGrid {...dayProps({ therapists: [therapists[0]] })} />);
    const grid = container.querySelector<HTMLElement>('[data-schedule-grid]')!;
    expect(grid.className).not.toContain('overflow-auto');
    expect(container.querySelector<HTMLElement>('[data-grid-header]')!.style.top).toContain('61px');
    cleanup();
    const many = Array.from({ length: 4 }, (_, i) => ({ ...therapists[0], id: `t-many-${i}`, name: `Therapist ${i}` }));
    const wide = render(<MobileDayGrid {...dayProps({ therapists: many, appointments: [] })} />);
    expect(wide.container.querySelector<HTMLElement>('[data-schedule-grid]')!.className).toContain('overflow-auto');
  });

  it('page scroll: positions the page once when the grid opens, not again on a date change', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const props = dayProps({ therapists: [therapists[0]], appointments: [], hours: { startHour: 8, endHour: 21 }, nowMinutes: 19 * 60 });
    const { rerender } = render(<MobileDayGrid {...props} />);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    // The next day's first appointment is late too, so only the once-per-mount rule keeps the page still.
    const late = appointment({ id: 'late', scheduledAt: localDateTime('2026-10-02', '19:00').toISOString() });
    rerender(<MobileDayGrid {...props} date="2026-10-02" appointments={[late]} />);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('page scroll: the "tap a free time to move" bar is pinned above the bottom nav', () => {
    vi.useFakeTimers();
    try {
      render(<MobileDayGrid {...dayProps({ therapists: [therapists[0]], nowMinutes: 8 * 60, drag: { canDrag: () => true, onMove: vi.fn() } })} />);
      fireEvent.pointerDown(screen.getByRole('button', { name: /Priya/ }), { pointerType: 'touch', clientX: 150, clientY: 100 });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.pointerUp(window, { pointerType: 'touch' });
      expect(screen.getByRole('status')).toHaveTextContent('Tap free time to move Priya');
      expect(document.querySelector('[data-placing-bar]')!.className).toContain('fixed');
    } finally {
      vi.useRealTimers();
    }
  });

  describe('touch drag', () => {
    // One-column phone Day at 30-minute slots: 4/3 px per minute, so 20px is one 15-minute step.
    const touchProps = (onMove = vi.fn(), appointments = [appointment({})]) =>
      dayProps({ therapists: [therapists[0]], nowMinutes: 8 * 60, appointments, drag: { canDrag: () => true, onMove } });
    const hold = (y = 300) => {
      fireEvent.pointerDown(screen.getByRole('button', { name: /Priya/ }), { pointerType: 'touch', clientX: 150, clientY: y });
      act(() => {
        vi.advanceTimersByTime(350);
      });
    };

    it('press and hold lifts the block, then the finger moves it in 15-minute steps', () => {
      vi.useFakeTimers();
      try {
        const onMove = vi.fn();
        render(<MobileDayGrid {...touchProps(onMove)} />);
        hold();
        fireEvent.pointerMove(window, { pointerType: 'touch', clientX: 150, clientY: 320 });
        expect(document.querySelector('[data-drag-ghost]')).toHaveTextContent('10:15 AM');
        fireEvent.pointerMove(window, { pointerType: 'touch', clientX: 150, clientY: 340 });
        expect(document.querySelector('[data-drag-ghost]')).toHaveTextContent('10:30 AM');
        fireEvent.pointerUp(window, { pointerType: 'touch' });
        expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), expect.objectContaining({ start: 630, duration: 60 }));
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a swipe before the hold scrolls instead of lifting', () => {
      vi.useFakeTimers();
      try {
        const onMove = vi.fn();
        render(<MobileDayGrid {...touchProps(onMove)} />);
        fireEvent.pointerDown(screen.getByRole('button', { name: /Priya/ }), { pointerType: 'touch', clientX: 150, clientY: 300 });
        fireEvent.pointerMove(window, { pointerType: 'touch', clientX: 150, clientY: 340 });
        act(() => {
          vi.advanceTimersByTime(500);
        });
        fireEvent.pointerUp(window, { pointerType: 'touch' });
        expect(document.querySelector('[data-drag-ghost]')).toBeNull();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(onMove).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops the page scrolling only while a block is lifted', () => {
      vi.useFakeTimers();
      try {
        render(<MobileDayGrid {...touchProps()} />);
        const grid = document.querySelector('[data-schedule-grid]')!;
        const swipe = new Event('touchmove', { cancelable: true });
        grid.dispatchEvent(swipe);
        expect(swipe.defaultPrevented).toBe(false);
        hold();
        const drag = new Event('touchmove', { cancelable: true });
        grid.dispatchEvent(drag);
        expect(drag.defaultPrevented).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('auto-scrolls the page while the finger is held near the bottom edge', () => {
      vi.useFakeTimers();
      try {
        const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
        render(<MobileDayGrid {...touchProps()} />);
        hold();
        fireEvent.pointerMove(window, { pointerType: 'touch', clientX: 150, clientY: window.innerHeight - 70 });
        act(() => {
          vi.advanceTimersByTime(100);
        });
        expect(scrollBy).toHaveBeenCalled();
        expect(scrollBy.mock.calls.every(([, dy]) => (dy as number) > 0)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a block held still at the edge does not auto-scroll, so letting go still offers tap targets', () => {
      vi.useFakeTimers();
      try {
        const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
        const onMove = vi.fn();
        render(<MobileDayGrid {...touchProps(onMove)} />);
        hold(window.innerHeight - 70);
        act(() => {
          vi.advanceTimersByTime(200);
        });
        fireEvent.pointerUp(window, { pointerType: 'touch' });
        expect(scrollBy).not.toHaveBeenCalled();
        expect(onMove).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Tap free time to move Priya');
      } finally {
        vi.useRealTimers();
      }
    });

    it('held and let go in place: tap targets every 30 minutes that fit the full length', () => {
      vi.useFakeTimers();
      try {
        const short = appointment({ id: 'b', patientName: 'Ravi K', scheduledAt: localDateTime('2026-10-01', '11:00').toISOString(), durationMinutes: 30 });
        render(<MobileDayGrid {...touchProps(vi.fn(), [appointment({}), short])} />);
        hold();
        fireEvent.pointerUp(window, { pointerType: 'touch' });
        expect(screen.getByRole('status')).toHaveTextContent('Tap free time to move Priya');
        const targets = screen.getAllByRole('button', { name: /^Move here/ }).map((b) => b.getAttribute('aria-label')!.replace(/.* at /, ''));
        // The hour-long block frees its own time, can't overlap 11:00–11:30, and must end by 1 PM.
        expect(targets).toEqual(['9:00 AM', '9:30 AM', '10:00 AM', '11:30 AM', '12:00 PM']);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('the rail hides an hour label while the Now badge sits on it, and shows it again otherwise', () => {
    const { rerender } = render(<MobileDayGrid {...dayProps({ therapists: [therapists[0]], nowMinutes: 11 * 60 })} />);
    expect(screen.queryByText('11')).not.toBeInTheDocument();
    rerender(<MobileDayGrid {...dayProps({ therapists: [therapists[0]], nowMinutes: 11 * 60 + 20 })} />);
    expect(screen.getByText('11')).toBeInTheDocument();
  });

});
