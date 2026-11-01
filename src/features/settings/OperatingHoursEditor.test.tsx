// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OperatingHoursEditor, changeFor, operatingProblem } from './OperatingHoursEditor';
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

describe('OperatingHoursEditor', () => {
  afterEach(cleanup);

  it('shows a plain clinic as one session with no closure, and offers the split', () => {
    render(<OperatingHoursEditor operatingHours={null} startHour={9} endHour={17} closedWeekdays={[0]} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Open starts')).toHaveValue('09:00');
    expect(screen.getByLabelText('Open ends')).toHaveValue('17:00');
    expect(screen.getByRole('checkbox', { name: /Closed in the middle of the day/ })).not.toBeChecked();
    expect(screen.queryByLabelText('Open again starts')).toBeNull();
  });

  it('ticking the closure cuts the day in two, stores the hours and keeps the envelope', () => {
    const onChange = vi.fn();
    render(<OperatingHoursEditor operatingHours={null} startHour={9} endHour={20} closedWeekdays={[0]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Closed in the middle of the day/ }));
    const [change, problem] = onChange.mock.calls[0];
    expect(problem).toBeNull();
    expect(change.bookingStartHour).toBe(9);
    expect(change.bookingEndHour).toBe(20);
    expect(change.operatingHours['1']).toEqual([[540, 810], [930, 1200]]);
  });

  it('shows stored split hours with the closed stretch spelled out', () => {
    const hours = { '1': [[540, 780], [960, 1200]], '2': [[540, 780], [960, 1200]], '3': [[540, 780], [960, 1200]] } as never;
    render(<OperatingHoursEditor operatingHours={hours} startHour={9} endHour={20} closedWeekdays={[0, 4, 5, 6]} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Open again starts')).toHaveValue('16:00');
    expect(screen.getByText(/Closed 1:00 PM – 4:00 PM/)).toBeInTheDocument();
  });

  it('reports a problem when the second session starts before the first ends', () => {
    const onChange = vi.fn();
    const hours = { '1': [[540, 780], [960, 1200]] } as never;
    render(<OperatingHoursEditor operatingHours={hours} startHour={9} endHour={20} closedWeekdays={[0, 2, 3, 4, 5, 6]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Open again starts'), { target: { value: '12:00' } });
    expect(onChange.mock.calls[0][1]).toMatch(/second session must start after the first one ends/);
  });

  it('customise per day lists each open weekday, and goes back to one pattern', () => {
    render(<OperatingHoursEditor operatingHours={null} startHour={9} endHour={17} closedWeekdays={[0, 3, 4, 5, 6]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Customise per day' }));
    expect(screen.getByText('Monday')).toBeInTheDocument();
    expect(screen.getByText('Tuesday')).toBeInTheDocument();
    expect(screen.queryByText('Wednesday')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use the same hours every day' }));
    expect(screen.queryByText('Monday')).toBeNull();
  });
});
