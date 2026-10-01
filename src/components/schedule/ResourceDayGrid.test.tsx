// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
import { localDateTime } from '@/domain/schedule';
import { PX_PER_MINUTE, ResourceDayGrid, type GridTherapist } from './TimeGrid';

const OPEN = { closed: false, kind: null, label: null } as const;

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: 'a1', clinicId: 'c1', patientId: null, patientName: 'Priya', patientPhone: '1',
    therapistId: 't1', scheduledAt: localDateTime('2026-10-01', '10:00').toISOString(),
    durationMinutes: 45, status: 'confirmed', requestId: null, visitId: null,
    rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '',
    ...overrides,
  };
}

const therapists: GridTherapist[] = [
  { id: 't1', name: 'Dr Asha', color: '#468adb' },
  { id: 't2', name: 'Dr Ravi', color: '#ee7c4e' },
];

type Props = Parameters<typeof ResourceDayGrid>[0];

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    date: '2026-10-01',
    today: '2026-09-30',
    nowMinutes: 600,
    therapists,
    appointments: [appointment({})],
    hours: { startHour: 9, endHour: 12 },
    slotMinutes: 30,
    closed: OPEN,
    colorFor: () => '#468adb',
    selectedId: null,
    onSelect: vi.fn(),
    canBookFor: () => true,
    onBook: vi.fn(),
    summaryFor: (id) => (id === 't1' ? { text: '1 booked, 6 slots free', ratio: 0.2 } : { text: 'None', ratio: null }),
    ...overrides,
  };
}

describe('ResourceDayGrid', () => {
  afterEach(cleanup);

  it('renders one column per therapist with its day summary', () => {
    render(<ResourceDayGrid {...baseProps()} />);
    expect(screen.getByText('Dr Asha')).toBeInTheDocument();
    expect(screen.getByText('Dr Ravi')).toBeInTheDocument();
    expect(screen.getByText('1 booked, 6 slots free')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Day booked' })).toHaveAttribute('aria-valuenow', '20');
  });

  it('sizes and positions a block by its start and length', () => {
    render(<ResourceDayGrid {...baseProps()} />);
    const block = screen.getByRole('button', { name: /Priya/ });
    expect(block.style.top).toBe(`${60 * PX_PER_MINUTE}px`);
    expect(block.style.height).toBe(`${45 * PX_PER_MINUTE - 1}px`);
    expect(block).toHaveTextContent('10:00 AM–10:45 AM');
    expect(block).not.toHaveTextContent('45m'); // the range already says how long
  });

  it('offers only free, non-overlapping slots for booking', () => {
    const props = baseProps();
    render(<ResourceDayGrid {...props} />);
    expect(screen.queryByRole('button', { name: 'Book Dr Asha at 10:00 AM' })).not.toBeInTheDocument();
    // 10:30 starts before the 45-minute booking ends at 10:45.
    expect(screen.queryByRole('button', { name: 'Book Dr Asha at 10:30 AM' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Book Dr Asha at 11:00 AM' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Book Dr Ravi at 9:30 AM' }));
    expect(props.onBook).toHaveBeenCalledWith({ time: '09:30', therapistId: 't2' });
  });

  it('hides booking where the viewer may not book', () => {
    render(<ResourceDayGrid {...baseProps({ canBookFor: (id) => id === 't1' })} />);
    expect(screen.queryByRole('button', { name: /Book Dr Ravi/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Book Dr Asha at 9:00 AM' })).toBeInTheDocument();
  });

  it('opens details when a block is clicked', () => {
    const props = baseProps();
    render(<ResourceDayGrid {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Priya/ }));
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('shows the now line only on today, and skips past slots', () => {
    const { container, rerender } = render(<ResourceDayGrid {...baseProps()} />);
    expect(container.querySelectorAll('[data-now-line]')).toHaveLength(0);
    rerender(<ResourceDayGrid {...baseProps({ today: '2026-10-01', appointments: [] })} />);
    expect(container.querySelectorAll('[data-now-line]')).toHaveLength(2); // one per column
    expect(screen.queryByRole('button', { name: 'Book Dr Asha at 9:30 AM' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Book Dr Asha at 10:00 AM' })).toBeInTheDocument();
  });

  it('puts overlapping unassigned appointments side by side', () => {
    render(
      <ResourceDayGrid
        {...baseProps({
          therapists: [...therapists, { id: '', name: 'Unassigned', color: '#999' }],
          appointments: [
            appointment({ id: 'u1', therapistId: null, patientName: 'Anil' }),
            appointment({ id: 'u2', therapistId: null, patientName: 'Bela' }),
          ],
        })}
      />
    );
    expect(screen.getByRole('button', { name: /Anil/ }).style.width).toBe('calc(50% - 4px)');
    expect(screen.getByRole('button', { name: /Bela/ }).style.left).toBe('calc(50% + 2px)');
  });

  it('shows closed days and offers no free slots', () => {
    render(<ResourceDayGrid {...baseProps({ closed: { closed: true, kind: 'holiday', label: 'Diwali' }, appointments: [] })} />);
    expect(screen.getAllByText('Closed · Diwali')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^Book / })).not.toBeInTheDocument();
  });
});

describe('ResourceDayGrid drag', () => {
  afterEach(cleanup);

  function mockColumns(container: HTMLElement) {
    const columns = container.querySelectorAll<HTMLElement>('[aria-label$=", 2026-10-01"]');
    columns.forEach((column, index) => {
      column.getBoundingClientRect = () =>
        ({ left: 100 + index * 200, right: 300 + index * 200, top: 0, bottom: 500, width: 200, height: 500, x: 0, y: 0, toJSON() {} }) as DOMRect;
    });
  }

  it('mouse: dragging a block down 30 minutes moves it; the click does not open details', () => {
    const onMove = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <ResourceDayGrid {...baseProps({ onSelect, drag: { canDrag: () => true, onMove } })} />
    );
    mockColumns(container);
    const block = screen.getByRole('button', { name: /Priya/ });
    fireEvent.pointerDown(block, { pointerType: 'mouse', button: 0, clientX: 150, clientY: 100 });
    fireEvent.pointerMove(window, { pointerType: 'mouse', clientX: 150, clientY: 100 + 60 * PX_PER_MINUTE });
    expect(container.querySelector('[data-drag-ghost]')).toHaveTextContent('11:00 AM · 45m');
    fireEvent.pointerUp(window, { pointerType: 'mouse' });
    fireEvent.click(block);
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), { date: '2026-10-01', therapistId: 't1', start: 660, duration: 45 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('mouse: dropping into another therapist column targets that therapist', () => {
    const onMove = vi.fn();
    const { container } = render(<ResourceDayGrid {...baseProps({ drag: { canDrag: () => true, onMove } })} />);
    mockColumns(container);
    fireEvent.pointerDown(screen.getByRole('button', { name: /Priya/ }), { pointerType: 'mouse', button: 0, clientX: 150, clientY: 100 });
    fireEvent.pointerMove(window, { pointerType: 'mouse', clientX: 350, clientY: 100 });
    fireEvent.pointerUp(window, { pointerType: 'mouse' });
    expect(onMove).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ therapistId: 't2', start: 600 }));
  });

  it('touch: long-press then tap a free time to move', () => {
    vi.useFakeTimers();
    try {
      const onMove = vi.fn();
      render(<ResourceDayGrid {...baseProps({ drag: { canDrag: () => true, onMove } })} />);
      fireEvent.pointerDown(screen.getByRole('button', { name: /Priya/ }), { pointerType: 'touch', clientX: 150, clientY: 100 });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.pointerUp(window, { pointerType: 'touch' });
      expect(screen.getByRole('status')).toHaveTextContent('Tap a free time to move Priya');
      fireEvent.click(screen.getByRole('button', { name: 'Move here: Dr Ravi at 11:00 AM' }));
      expect(onMove).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ therapistId: 't2', start: 660, duration: 45 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks that cannot be dragged ignore pointer drags', () => {
    const onMove = vi.fn();
    const { container } = render(<ResourceDayGrid {...baseProps({ drag: { canDrag: () => false, onMove } })} />);
    mockColumns(container);
    fireEvent.pointerDown(screen.getByRole('button', { name: /Priya/ }), { pointerType: 'mouse', button: 0, clientX: 150, clientY: 100 });
    fireEvent.pointerMove(window, { pointerType: 'mouse', clientX: 150, clientY: 300 });
    fireEvent.pointerUp(window, { pointerType: 'mouse' });
    expect(onMove).not.toHaveBeenCalled();
  });
});
