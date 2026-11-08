// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TodayTherapistFilter, TodayVisitsTotals } from './TodayVisitsExtras';

afterEach(cleanup);

const totals = { visits: 3, billedPaise: 180000, paidPaise: 100000, duePaise: 80000 };

describe('TodayTherapistFilter', () => {
  it('offers everyone plus each therapist with a count, and reports the pick', () => {
    const onChange = vi.fn();
    render(<TodayTherapistFilter options={[{ id: 'a', name: 'Asha', count: 3 }]} value="" onChange={onChange} />);
    expect(screen.getByRole('option', { name: 'All therapists' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Therapist' }), { target: { value: 'a' } });
    expect(onChange).toHaveBeenCalledWith('a');
    expect(screen.getByRole('option', { name: 'Asha (3)' })).toBeInTheDocument();
  });
});

describe('TodayVisitsTotals', () => {
  it('shows visits, billed, paid and due', () => {
    render(<TodayVisitsTotals totals={totals} label="Asha, today" showMoney />);
    const group = screen.getByRole('group', { name: 'Totals for the visits shown' });
    expect(group).toHaveTextContent('Asha, today');
    expect(group).toHaveTextContent('Visits 3');
    expect(group).toHaveTextContent(/Billed .*1,800/);
    expect(group).toHaveTextContent(/Paid .*1,000/);
    expect(group).toHaveTextContent(/Due .*800/);
  });

  it('shows only the visit count without money rights', () => {
    render(<TodayVisitsTotals totals={totals} label="Today" showMoney={false} />);
    const group = screen.getByRole('group', { name: 'Totals for the visits shown' });
    expect(group).toHaveTextContent('Visits 3');
    expect(group).not.toHaveTextContent('Billed');
    expect(group).not.toHaveTextContent('Due');
  });
});
