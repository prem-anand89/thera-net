// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
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
