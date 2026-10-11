// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MonthlyRevenueChart } from './MonthlyRevenueChart';
import { MonthlyVisitsChart } from './MonthlyVisitsChart';
import { formatINR } from '@/domain/money';

afterEach(cleanup);

const categories = ['Aug', 'Sep', 'Oct'];
const revenuePaise = [15000000, 20000000, 25000000];
const visitCounts = [20, 28, 35];

describe('MonthlyRevenueChart', () => {
  it('renders headline revenue, MoM delta, and selectable bars', () => {
    const onSelect = vi.fn();
    const onHover = vi.fn();
    render(
      <MonthlyRevenueChart
        categories={categories}
        revenuePaise={revenuePaise}
        formatRevenue={formatINR}
        selectedIndex={2}
        onSelectIndex={onSelect}
        onHoverIndex={onHover}
      />
    );

    expect(screen.getByText(/Monthly Revenue/i)).toBeInTheDocument();
    expect(screen.getByText('₹2,50,000')).toBeInTheDocument();
    expect(screen.getByText(/\+25%/i)).toBeInTheDocument(); // 250k vs 200k = +25%

    const sepBar = screen.getByRole('button', { name: /Sep: ₹2,00,000/i });
    fireEvent.mouseEnter(sepBar);
    expect(onHover).toHaveBeenCalledWith(1);
    expect(screen.getAllByText(/Sep: ₹2,00,000/i).length).toBeGreaterThan(0);

    fireEvent.click(sepBar);
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

describe('MonthlyVisitsChart', () => {
  it('renders headline visits count, MoM delta, and selectable bars', () => {
    const onSelect = vi.fn();
    const onHover = vi.fn();
    render(
      <MonthlyVisitsChart
        categories={categories}
        visitCounts={visitCounts}
        selectedIndex={2}
        onSelectIndex={onSelect}
        onHoverIndex={onHover}
      />
    );

    expect(screen.getByText(/Patient Visits/i)).toBeInTheDocument();
    expect(screen.getByText('35 visits')).toBeInTheDocument();
    expect(screen.getByText(/\+7 vs prior/i)).toBeInTheDocument(); // 35 vs 28 = +7

    const sepBar = screen.getByRole('button', { name: /Sep: 28 visits/i });
    fireEvent.mouseEnter(sepBar);
    expect(onHover).toHaveBeenCalledWith(1);
    expect(screen.getAllByText(/Sep: 28 visits/i).length).toBeGreaterThan(0);

    fireEvent.click(sepBar);
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
