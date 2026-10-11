// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
import { localDateTime } from '@/domain/schedule';
import { MultiResourceWeekGrid, type MultiResourceWeekGridProps } from './MultiResourceWeekGrid';
import type { GridTherapist } from './TimeGrid';

const OPEN = { closed: false, kind: null, label: null } as const;
const CLOSED = { closed: true, kind: 'holiday' as const, label: 'Gandhi Jayanti' };

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: 'a1',
    clinicId: 'c1',
    patientId: 'p1',
    patientName: 'Priya Sharma',
    patientPhone: '+91 98200 00001',
    therapistId: 't1',
    scheduledAt: localDateTime('2026-10-01', '10:00').toISOString(),
    durationMinutes: 45,
    status: 'confirmed',
    requestId: null,
    visitId: null,
    rescheduleCount: 0,
    previousScheduledAt: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const therapists: GridTherapist[] = [
  { id: 't1', name: 'Dr Asha', color: '#468adb' },
  { id: 't2', name: 'Dr Ravi', color: '#ee7c4e' },
];

function baseProps(overrides: Partial<MultiResourceWeekGridProps> = {}): MultiResourceWeekGridProps {
  return {
    days: ['2026-10-01', '2026-10-02', '2026-10-03'],
    today: '2026-10-01',
    nowMinutes: 600,
    therapists,
    appointments: [appointment({})],
    hours: { startHour: 9, endHour: 12 },
    slotMinutes: 30,
    closedFor: (d) => (d === '2026-10-02' ? CLOSED : OPEN),
    colorFor: () => '#468adb',
    selectedId: null,
    onSelect: vi.fn(),
    onBook: vi.fn(),
    onOpenDay: vi.fn(),
    workingFor: () => [{ start: 540, end: 720 }],
    ...overrides,
  };
}

describe('MultiResourceWeekGrid', () => {
  afterEach(cleanup);

  it('renders day headers and therapist sub-headers for open days', () => {
    render(<MultiResourceWeekGrid {...baseProps()} />);

    // Day headers
    expect(screen.getByRole('button', { name: /Open 2026-10-01 in day view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open 2026-10-02 in day view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open 2026-10-03 in day view/i })).toBeInTheDocument();

    // Staff subheaders - short names extracted
    const ashaHeaders = screen.getAllByText('Asha');
    expect(ashaHeaders.length).toBeGreaterThanOrEqual(1);

    const raviHeaders = screen.getAllByText('Ravi');
    expect(raviHeaders.length).toBeGreaterThanOrEqual(1);
  });

  it('renders a single merged column for closed days', () => {
    render(<MultiResourceWeekGrid {...baseProps()} />);

    // Oct 2 is closed, should have "Closed" sub-header
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('calls onOpenDay when clicking a day header button', () => {
    const onOpenDay = vi.fn();
    render(<MultiResourceWeekGrid {...baseProps({ onOpenDay })} />);

    const dayBtn = screen.getByRole('button', { name: /Open 2026-10-01 in day view/i });
    fireEvent.click(dayBtn);

    expect(onOpenDay).toHaveBeenCalledWith('2026-10-01');
  });

  it('renders minimal appointment blocks with tooltip titles and handles selection', () => {
    const onSelect = vi.fn();
    const appt = appointment({});
    render(<MultiResourceWeekGrid {...baseProps({ appointments: [appt], onSelect })} />);

    // Minimal block has title="Priya Sharma • 10:00 AM–10:45 AM"
    const apptBtn = screen.getByRole('button', { name: /Priya Sharma/i });
    expect(apptBtn).toBeInTheDocument();

    fireEvent.click(apptBtn);
    expect(onSelect).toHaveBeenCalledWith(appt);
  });

  it('triggers onBook with date, time, and therapistId when clicking an empty slot', () => {
    const onBook = vi.fn();
    render(
      <MultiResourceWeekGrid
        {...baseProps({
          appointments: [],
          onBook,
        })}
      />
    );

    // Look for a book button for Dr Ravi at 11:00 AM on 2026-10-01
    const slotBtn = screen.getByRole('button', { name: /Book Dr Ravi, 2026-10-01 at 11:00 AM/i });
    expect(slotBtn).toBeInTheDocument();

    fireEvent.click(slotBtn);
    expect(onBook).toHaveBeenCalledWith({
      date: '2026-10-01',
      time: '11:00',
      therapistId: 't2',
    });
  });

  it('handles empty therapist list gracefully', () => {
    render(<MultiResourceWeekGrid {...baseProps({ therapists: [] })} />);

    // Open days should show "No staff"
    expect(screen.getAllByText('No staff').length).toBeGreaterThanOrEqual(1);
  });
});
