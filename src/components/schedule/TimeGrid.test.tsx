// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
import type { PatientFlagContext } from '@/domain/patientFlags';
import { DayColumn } from './TimeGrid';

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
