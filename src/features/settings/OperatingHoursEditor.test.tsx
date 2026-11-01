// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OperatingHoursEditor, barRange, changeFor, operatingProblem, rulerTicks } from './OperatingHoursEditor';
import type { Shifts } from '@/domain/operatingHours';

const split: Shifts = { s1: [540, 780], s2: [960, 1200] };

describe('changeFor', () => {
  it('a plain whole-hour block, the same every day, is the old behaviour: no stored hours, just the two hours', () => {
    expect(changeFor({ s1: [540, 1020], s2: null }, {}, [1, 2, 3])).toEqual({ operatingHours: null, bookingStartHour: 9, bookingEndHour: 17 });
  });

  it('a closure in the middle is stored in full, with the envelope derived from it', () => {
    const change = changeFor(split, {}, [1, 2, 3])!;
    expect(change.bookingStartHour).toBe(9);
    expect(change.bookingEndHour).toBe(20);
    expect(change.operatingHours?.['3']).toEqual([[540, 780], [960, 1200]]);
  });

  it('a half-hour start cannot be two whole hours, so it is stored', () => {
    const change = changeFor({ s1: [570, 1020], s2: null }, {}, [1])!;
    expect(change.operatingHours).not.toBeNull();
    expect(change.bookingStartHour).toBe(9);
  });

  it('different days are stored for the open days only', () => {
    const change = changeFor(null, { 1: split, 2: { s1: [540, 1020], s2: null } }, [1, 2])!;
    expect(Object.keys(change.operatingHours!).sort()).toEqual(['1', '2']);
  });
});

describe('operatingProblem', () => {
  it('names the weekday that has the problem', () => {
    const bad: Shifts = { s1: [540, 780], s2: [700, 1200] };
    expect(operatingProblem(null, { 1: split, 2: bad }, [1, 2])).toMatch(/^Tuesday: the second session must start after/);
    expect(operatingProblem(bad, {}, [1])).toMatch(/second session must start after/);
    expect(operatingProblem(split, {}, [1])).toBeNull();
  });
});

describe('barRange and rulerTicks', () => {
  it('spans the week from opening to closing, widened by the staff-only hours and kept inside the day', () => {
    const groups = [{ shifts: { s1: [570, 780], s2: [840, 1080] } as Shifts }, { shifts: { s1: [600, 720], s2: null } as Shifts }];
    expect(barRange(groups, 0)).toEqual({ lo: 540, hi: 1080, openFrom: 540, openTo: 1080 });
    expect(barRange(groups, 3)).toEqual({ lo: 360, hi: 1260, openFrom: 540, openTo: 1080 });
    expect(barRange([{ shifts: { s1: [60, 1380], s2: null } }], 4)).toEqual({ lo: 0, hi: 1440, openFrom: 60, openTo: 1380 });
    expect(barRange([], 2)).toBeNull();
  });

  it('marks the start and end, in an even step when one fits', () => {
    expect(rulerTicks(540, 1080)).toEqual([540, 720, 900, 1080]); // 9 to 6: every 3 hours
    expect(rulerTicks(540, 780)).toEqual([540, 600, 660, 720, 780]); // 9 to 1: every hour
    expect(rulerTicks(420, 1200)).toEqual([420, 600, 780, 960, 1200]); // 7 to 8: every 3 hours, 7 PM dropped next to 8 PM
  });
});

describe('OperatingHoursEditor', () => {
  afterEach(cleanup);

  it('shows a plain clinic as one session with no closure, and offers the split', () => {
    render(<OperatingHoursEditor operatingHours={null} startHour={9} endHour={17} closedWeekdays={[0]} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Open starts')).toHaveValue('09:00');
    expect(screen.getByLabelText('Open ends')).toHaveValue('17:00');
    expect(screen.getByRole('radio', { name: 'Continuous' })).toBeChecked();
    expect(screen.queryByLabelText('Session 2 starts')).toBeNull();
  });

  it('choosing Split cuts the day in two, stores the hours and keeps the envelope', () => {
    const onChange = vi.fn();
    render(<OperatingHoursEditor operatingHours={null} startHour={9} endHour={20} closedWeekdays={[0]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Split' }));
    const [change, problem] = onChange.mock.calls[0];
    expect(problem).toBeNull();
    expect(change.bookingStartHour).toBe(9);
    expect(change.bookingEndHour).toBe(20);
    expect(change.operatingHours['1']).toEqual([[540, 810], [930, 1200]]);
  });

  it('shows stored split hours with the closed stretch spelled out', () => {
    const hours = { '1': [[540, 780], [960, 1200]], '2': [[540, 780], [960, 1200]], '3': [[540, 780], [960, 1200]] } as never;
    render(<OperatingHoursEditor operatingHours={hours} startHour={9} endHour={20} closedWeekdays={[0, 4, 5, 6]} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Session 2 starts')).toHaveValue('16:00');
    expect(screen.getByText(/Closed 1:00 PM – 4:00 PM/)).toBeInTheDocument();
  });

  it('reports a problem when the second session starts before the first ends', () => {
    const onChange = vi.fn();
    const hours = { '1': [[540, 780], [960, 1200]] } as never;
    render(<OperatingHoursEditor operatingHours={hours} startHour={9} endHour={20} closedWeekdays={[0, 2, 3, 4, 5, 6]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Session 2 starts'), { target: { value: '12:00' } });
    expect(onChange.mock.calls[0][1]).toMatch(/second session must start after the first one ends/);
  });

  it('choosing Continuous again joins the two sessions from first start to last end', () => {
    const onChange = vi.fn();
    const hours = { '1': [[540, 780], [960, 1200]] } as never;
    render(<OperatingHoursEditor operatingHours={hours} startHour={9} endHour={20} closedWeekdays={[0, 2, 3, 4, 5, 6]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Continuous' }));
    // One whole-hour block is the plain two-hour setting: nothing stored beyond the hours.
    expect(onChange.mock.calls[0][0]).toEqual({ operatingHours: null, bookingStartHour: 9, bookingEndHour: 20 });
  });

  it('the day bar draws the sessions and the closure on a ruler, with the times in words underneath', () => {
    const hours = { '1': [[540, 780], [840, 1080]] } as never;
    render(<OperatingHoursEditor operatingHours={hours} startHour={9} endHour={18} closedWeekdays={[0, 2, 3, 4, 5, 6]} onChange={vi.fn()} />);
    const bar = screen.getByTestId('day-bar');
    expect(bar).toHaveAccessibleName(/9:00 AM – 1:00 PM, 2:00 PM – 6:00 PM\. Closed 1:00 PM – 2:00 PM/);
    expect(bar.querySelectorAll('[data-part="open"]')).toHaveLength(2);
    expect(bar.querySelectorAll('[data-part="closed"]')).toHaveLength(1);
    // Ruler only, from opening to closing (no staff hours here), no times written on the bar itself.
    expect(bar).toHaveTextContent('9 AM12 PM3 PM6 PM');
    expect(screen.getByTestId('hours-summary')).toHaveTextContent('8h open · Closed 1:00 PM – 2:00 PM (1h)');
  });

  it('one plain card, with no day tiles, while every open day has the same hours', () => {
    render(<OperatingHoursEditor operatingHours={null} startHour={9} endHour={17} closedWeekdays={[0, 3, 4, 5, 6]} onChange={vi.fn()} />);
    expect(screen.getAllByRole('group', { name: /^Hours for / })).toHaveLength(1);
    expect(screen.queryByRole('group', { name: /Days with these hours/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Add different hours/ })).toBeInTheDocument();
  });

  it('days with different hours are grouped into one card each, not one card per day', () => {
    const hours = {
      '1': [[540, 780], [960, 1200]],
      '2': [[540, 780], [960, 1200]],
      '3': [[540, 780], [960, 1200]],
      '6': [[540, 780]],
    } as never;
    render(<OperatingHoursEditor operatingHours={hours} startHour={9} endHour={20} closedWeekdays={[0, 4, 5]} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Hours for Mon–Wed' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Hours for Sat' })).toBeInTheDocument();
  });

  it("tapping a day's chip on another card gives that day those hours", () => {
    const onChange = vi.fn();
    const hours = { '1': [[540, 780], [960, 1200]], '2': [[540, 780], [960, 1200]], '6': [[540, 780]] } as never;
    render(<OperatingHoursEditor operatingHours={hours} startHour={9} endHour={20} closedWeekdays={[0, 3, 4, 5]} onChange={onChange} />);
    const satCard = screen.getByRole('group', { name: 'Hours for Sat' });
    fireEvent.click(within(within(satCard).getByRole('group', { name: /Days with these hours/ })).getByRole('button', { name: 'Tue' }));
    const stored = onChange.mock.calls[0][0].operatingHours;
    expect(stored['2']).toEqual([[540, 780]]);
    expect(stored['1']).toEqual([[540, 780], [960, 1200]]);
  });

  it('Add different hours starts a card with no days; tapping a day gives it those hours', () => {
    const onChange = vi.fn();
    render(<OperatingHoursEditor operatingHours={null} startHour={9} endHour={17} closedWeekdays={[0]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add different hours/ }));
    const draft = screen.getByRole('group', { name: 'New hours' });
    fireEvent.change(within(draft).getByLabelText('Open ends'), { target: { value: '13:00' } });
    expect(onChange).not.toHaveBeenCalled(); // nothing stored until a day uses it
    fireEvent.click(within(within(draft).getByRole('group', { name: 'Days with the new hours' })).getByRole('button', { name: 'Sat' }));
    const stored = onChange.mock.calls[0][0].operatingHours;
    expect(stored['6']).toEqual([[540, 780]]);
    expect(stored['1']).toEqual([[540, 1020]]);
    expect(screen.queryByRole('group', { name: 'New hours' })).toBeNull();
  });

  it('cancelling a new set of hours stores nothing', () => {
    const onChange = vi.fn();
    render(<OperatingHoursEditor operatingHours={null} startHour={9} endHour={17} closedWeekdays={[0]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add different hours/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'New hours' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says what is wrong on the card itself, not only when saving', () => {
    const hours = { '1': [[540, 780], [700, 1200]] } as never;
    render(<OperatingHoursEditor operatingHours={hours} startHour={9} endHour={20} closedWeekdays={[0, 2, 3, 4, 5, 6]} onChange={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/second session must start after the first one ends/);
  });

  it('a new set of hours asks for the times first: its days cannot be picked while it matches the usual hours', () => {
    const onChange = vi.fn();
    render(<OperatingHoursEditor operatingHours={null} startHour={9} endHour={17} closedWeekdays={[0]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add different hours/ }));
    const tiles = screen.getByRole('group', { name: 'Days with the new hours' });
    expect(within(tiles).getByRole('button', { name: 'Sat' })).toBeDisabled();
    expect(screen.getByText(/Change the times above/)).toBeInTheDocument();
  });

  it('a different-hours day really unselects: tapping it again sends it back to the usual hours', () => {
    const onChange = vi.fn();
    const hours = { '1': [[540, 1020]], '2': [[540, 1020]], '3': [[540, 1020]], '6': [[540, 780]] } as never;
    render(<OperatingHoursEditor operatingHours={hours} startHour={9} endHour={17} closedWeekdays={[0, 4, 5]} onChange={onChange} />);
    expect(screen.getByText('Usual hours')).toBeInTheDocument();
    const card = screen.getByRole('group', { name: 'Hours for Sat' });
    fireEvent.click(within(within(card).getByRole('group', { name: /Days with these hours/ })).getByRole('button', { name: 'Sat' }));
    // Every open day back on 9 to 5: the plain whole-hour setting.
    expect(onChange.mock.calls[0][0]).toEqual({ operatingHours: null, bookingStartHour: 9, bookingEndHour: 17 });
  });

  it('Remove sends every day on a different-hours card back to the usual hours', () => {
    const onChange = vi.fn();
    const hours = { '1': [[540, 1020]], '2': [[540, 1020]], '6': [[540, 780]] } as never;
    render(<OperatingHoursEditor operatingHours={hours} startHour={9} endHour={17} closedWeekdays={[0, 3, 4, 5]} onChange={onChange} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Hours for Sat' })).getByRole('button', { name: 'Remove' }));
    expect(onChange.mock.calls[0][0].operatingHours).toBeNull();
  });

  it('the day bar widens by the staff-only hours and says what the colours mean', () => {
    render(<OperatingHoursEditor bufferHours={2} operatingHours={null} startHour={9} endHour={18} closedWeekdays={[0]} onChange={vi.fn()} />);
    const bar = screen.getByTestId('day-bar');
    expect(bar.querySelectorAll('[data-part="staff"]')).toHaveLength(2);
    expect(bar).toHaveTextContent(/^7 AM/);
    expect(bar).toHaveTextContent(/8 PM$/);
    expect(screen.getByTestId('bar-legend')).toHaveTextContent('Staff can book');
  });

  it('read-only (not editing) offers no add button', () => {
    render(<OperatingHoursEditor editing={false} operatingHours={null} startHour={9} endHour={17} closedWeekdays={[0]} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Add different hours/ })).toBeNull();
  });

  it('a clinic open one day a week has no chips and nothing to add', () => {
    render(<OperatingHoursEditor operatingHours={null} startHour={9} endHour={17} closedWeekdays={[0, 2, 3, 4, 5, 6]} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Add different hours/ })).toBeNull();
  });
});
