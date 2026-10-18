// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
import type { PatientFlagContext } from '@/domain/patientFlags';
import { DayColumn, WeekTimeGrid } from './TimeGrid';

afterEach(cleanup);

const baseProps = {
  label: 'Thu',
  date: '2026-10-01',
  appointments: [] as Appointment[],
  hours: { startHour: 9, endHour: 18 },
  slotMinutes: 30,
  closed: { closed: false, kind: null, label: null },
  colorFor: () => '#2c5f63',
  nowMinutes: null,
  isPastDay: false,
  selectedId: null,
  onSelect: () => {},
};

describe('DayColumn off-hours classification', () => {
  it('marks the gap between two working intervals as a break, not a plain off-hours block', () => {
    const { container } = render(
      <DayColumn {...baseProps} working={[{ start: 540, end: 720 }, { start: 780, end: 1020 }]} />
    );
    const breakRanges = container.querySelectorAll('[data-break]');
    const offHoursRanges = container.querySelectorAll('[data-off-hours]');
    expect(breakRanges).toHaveLength(1);
    // before-open (open at 540 == 9:00, matches startHour, so no "before" gap) + the break + after-close
    expect(offHoursRanges.length).toBeGreaterThanOrEqual(2);
  });

  it('marks a day with zero working intervals as a single all-day off block, with no break', () => {
    const { container } = render(<DayColumn {...baseProps} working={[]} />);
    expect(container.querySelectorAll('[data-break]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-off-hours]')).toHaveLength(1);
  });
});

describe('DayColumn flag badges', () => {
  const appointment: Appointment = {
    id: 'a1', clinicId: 'c1', patientId: 'p1', patientName: 'Priya', patientPhone: '+91 98200 00001',
    therapistId: 't1', scheduledAt: '2026-10-01T04:30:00Z', durationMinutes: 30, status: 'confirmed',
    requestId: null, visitId: null, rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '',
  };
  const flagContext: PatientFlagContext = {
    patientIdsWithVisits: new Set(['p1']),
    packages: new Map(),
    balanceDue: new Set(['p1']),
    noShows: new Map(),
    conditionByPatient: new Map(),
    requestNotes: new Map(),
  };

  it('renders a flag badge when the appointment matches a flag', () => {
    const { container } = render(<DayColumn {...baseProps} appointments={[appointment]} flagContext={flagContext} />);
    expect(container.querySelectorAll('[class*="h-1.5"]')).toHaveLength(1);
  });

  it('renders no badge without a flagContext', () => {
    const { container } = render(<DayColumn {...baseProps} appointments={[appointment]} />);
    expect(container.querySelectorAll('[class*="h-1.5"]')).toHaveLength(0);
  });
});

describe('DayColumn off-hours booking and display', () => {
  it('renders off-hours empty cells as clickable with outside working hours aria-label', () => {
    const onBook = vi.fn();
    const { getByRole } = render(
      <DayColumn
        {...baseProps}
        working={[{ start: 600, end: 720 }]} // 10:00–12:00
        onBook={onBook}
      />
    );
    const offSlotBtn = getByRole('button', { name: 'Book Thu at 9:00 AM (outside working hours)' });
    expect(offSlotBtn).toBeInTheDocument();
    offSlotBtn.click();
    expect(onBook).toHaveBeenCalledWith('09:00');
  });

  it('does not render clickable free slots on a closed day', () => {
    const onBook = vi.fn();
    const { queryByRole } = render(
      <DayColumn
        {...baseProps}
        closed={{ closed: true, kind: 'weekday', label: null }}
        onBook={onBook}
      />
    );
    expect(queryByRole('button', { name: /Book Thu/ })).not.toBeInTheDocument();
  });

  it('renders an appointment outside regular clinic hours within the drawn range when hours are widened', () => {
    const earlyAppt: Appointment = {
      id: 'a-early', clinicId: 'c1', patientId: 'p1', patientName: 'Priya', patientPhone: '+91 98200 00001',
      therapistId: 't1', scheduledAt: '2026-10-01T02:00:00Z', // 7:30 AM IST (UTC+5:30: 02:00 UTC = 07:30 IST)
      durationMinutes: 30, status: 'confirmed', requestId: null, visitId: null, rescheduleCount: 0,
      previousScheduledAt: null, createdAt: '', updatedAt: '',
    };
    const { getByText } = render(
      <DayColumn
        {...baseProps}
        hours={{ startHour: 7, endHour: 18 }} // widened from 9 to 7 to cover 7:30 AM
        appointments={[earlyAppt]}
      />
    );
    expect(getByText('Priya')).toBeInTheDocument();
  });
});

describe('WeekTimeGrid props and responsive container', () => {
  const weekProps = {
    days: ['2026-10-01', '2026-10-02', '2026-10-03'],
    today: '2026-10-01',
    nowMinutes: 600,
    appointments: [] as Appointment[],
    hours: { startHour: 9, endHour: 18 },
    slotMinutes: 30,
    closedFor: () => ({ closed: false, kind: null, label: null }),
    colorFor: () => '#2c5f63',
    selectedId: null,
    onSelect: () => {},
    onOpenDay: () => {},
  };

  it('renders container with phone-friendly min/max heights and overscroll-contain', () => {
    const { container } = render(<WeekTimeGrid {...weekProps} />);
    const scrollBox = container.querySelector('[class*="overscroll-contain"]');
    expect(scrollBox).toBeInTheDocument();
    expect(scrollBox?.className).toContain('min-h-[320px]');
    expect(scrollBox?.className).toContain('tab:min-h-[420px]');
    expect(scrollBox?.className).toContain('max-h-[calc(100dvh-20rem)]');
    expect(scrollBox?.className).toContain('tab:max-h-[calc(100vh-240px)]');
  });

  it('accepts custom minColumnWidth and formats template accordingly', () => {
    const { container } = render(<WeekTimeGrid {...weekProps} minColumnWidth={98} />);
    const gridEl = container.querySelector('.grid');
    expect(gridEl?.getAttribute('style')).toContain('minmax(98px, 1fr)');
  });

  it('passes minimalBlocks down to DayColumn', () => {
    const appt: Appointment = {
      id: 'a1', clinicId: 'c1', patientId: 'p1', patientName: 'Priya Sharma', patientPhone: '+91 98200 00001',
      therapistId: 't1', scheduledAt: '2026-10-01T04:30:00Z', durationMinutes: 30, status: 'confirmed',
      requestId: null, visitId: null, rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '',
    };
    const { container } = render(
      <WeekTimeGrid {...weekProps} appointments={[appt]} minimalBlocks={true} />
    );
    // In minimalBlocks, the block renders with simple single-line name and time without detailed extra layout
    expect(container.querySelector('[class*="text-[10px]"]')).toBeInTheDocument();
  });
});

