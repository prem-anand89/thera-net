// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MiniCalendarStrip } from './MiniCalendarStrip';

describe('MiniCalendarStrip', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 30, 10, 0)); // Wed 30 Sep 2026, local
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function setup(overrides: Partial<Parameters<typeof MiniCalendarStrip>[0]> = {}) {
    const onSelectDate = vi.fn();
    render(
      <MiniCalendarStrip
        selectedDate="2026-10-01"
        onSelectDate={onSelectDate}
        appointmentDates={['2026-10-01', '2026-10-01', '2026-09-28']}
        {...overrides}
      />
    );
    return { onSelectDate };
  }

  it('renders one Monday–Sunday week containing the selected date', () => {
    setup();
    const days = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveAccessibleName(/Monday, 28 September/);
    expect(days[6]).toHaveAccessibleName(/Sunday, 4 October/);
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName(/Thursday, 1 October/);
  });

  it('shows appointment counts per day', () => {
    setup();
    expect(screen.getByRole('tab', { name: /1 October, 2 appointments/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /28 September, 1 appointments/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /29 September, 0 appointments/ })).toBeInTheDocument();
  });

  it('moves exactly one week with the arrows (Today lives in the Schedule toolbar)', () => {
    const { onSelectDate } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(onSelectDate).toHaveBeenLastCalledWith('2026-10-05');
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(onSelectDate).toHaveBeenLastCalledWith('2026-09-21');
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
  });

  it('selects a day on click and steps days with the arrow keys', () => {
    const { onSelectDate } = setup();
    fireEvent.click(screen.getByRole('tab', { name: /Saturday, 3 October/ }));
    expect(onSelectDate).toHaveBeenLastCalledWith('2026-10-03');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onSelectDate).toHaveBeenLastCalledWith('2026-10-02');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(onSelectDate).toHaveBeenLastCalledWith('2026-09-30');
  });

  it('marks closed days and holidays', () => {
    setup({
      closedFor: (date) =>
        date === '2026-10-02'
          ? { closed: true, kind: 'holiday', label: 'Gandhi Jayanti' }
          : date === '2026-10-04'
            ? { closed: true, kind: 'weekday', label: null }
            : { closed: false, kind: null, label: null },
    });
    expect(screen.getByRole('tab', { name: /2 October, closed \(Gandhi Jayanti\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /4 October, closed, / })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /3 October, 0 appointments/ })).not.toHaveAccessibleName(/closed/);
  });
});
