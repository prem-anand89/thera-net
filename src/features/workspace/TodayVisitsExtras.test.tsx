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
  it('shows billed, paid and due without redundant Visits count or Total label', () => {
    render(<TodayVisitsTotals totals={totals} label="Asha, today" showMoney />);
    const group = screen.getByRole('group', { name: 'Totals for the visits shown' });
    expect(group).toHaveTextContent('Asha, today');
    expect(group).not.toHaveTextContent('Visits 3');
    expect(group).toHaveTextContent(/Billed .*1,800/);
    expect(group).toHaveTextContent(/Paid .*1,000/);
    expect(group).toHaveTextContent(/Due .*800/);
  });

  it('omits generic Total label when unfiltered', () => {
    render(<TodayVisitsTotals totals={totals} label="Total" showMoney />);
    const group = screen.getByRole('group', { name: 'Totals for the visits shown' });
    expect(group).not.toHaveTextContent('Total');
    expect(group).toHaveTextContent(/Billed .*1,800/);
  });

  it('renders nothing without money rights and no therapist label', () => {
    const { container } = render(<TodayVisitsTotals totals={totals} label="Total" showMoney={false} />);
    expect(container.firstChild).toBeNull();
  });
});
