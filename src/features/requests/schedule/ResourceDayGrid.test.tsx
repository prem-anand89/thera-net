// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    summaryFor: (id) => (id === 't1' ? '1 · 45m' : 'Free'),
    ...overrides,
  };
}

describe('ResourceDayGrid', () => {
  afterEach(cleanup);

  it('renders one column per therapist with its day summary', () => {
    render(<ResourceDayGrid {...baseProps()} />);
    expect(screen.getByText('Dr Asha')).toBeInTheDocument();
    expect(screen.getByText('Dr Ravi')).toBeInTheDocument();
    expect(screen.getByText('1 · 45m')).toBeInTheDocument();
  });

  it('sizes and positions a block by its start and length', () => {
    render(<ResourceDayGrid {...baseProps()} />);
    const block = screen.getByRole('button', { name: /Priya/ });
    expect(block.style.top).toBe(`${60 * PX_PER_MINUTE}px`);
    expect(block.style.height).toBe(`${45 * PX_PER_MINUTE - 1}px`);
    expect(block).toHaveTextContent('10:00 AM–10:45 AM · 45m');
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
