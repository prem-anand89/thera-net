// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import {
  PractitionerPerformanceTable,
  type PractitionerPerformanceRow,
} from './PractitionerPerformanceTable';

afterEach(cleanup);

const mockRows: PractitionerPerformanceRow[] = [
  {
    therapistId: 't-1',
    name: 'Dr. Anita Sharma',
    photoPath: null,
    utilisation: {
      ratio: 0.75,
      workedMinutes: 450,
      availableMinutes: 600,
      offHoursMinutes: 0,
      usesClinicHours: false,
    },
    priorRatio: 0.6,
    visitCount: 15,
    revenuePaise: 3500000, // ₹35,000
    status: 'strong',
    reason: 'Above clinic average',
  },
  {
    therapistId: 't-2',
    name: 'Vikram Mehta',
    photoPath: null,
    utilisation: {
      ratio: 0.42,
      workedMinutes: 210,
      availableMinutes: 500,
      offHoursMinutes: 0,
      usesClinicHours: true,
    },
    priorRatio: 0.5,
    visitCount: 7,
    revenuePaise: 1400000, // ₹14,000
    status: 'attention',
    reason: 'Low utilisation',
  },
  {
    therapistId: 't-3',
    name: 'Pooja Roy',
    photoPath: null,
    utilisation: {
      ratio: 0.58,
      workedMinutes: 290,
      availableMinutes: 500,
      offHoursMinutes: 0,
      usesClinicHours: false,
    },
    priorRatio: null,
    visitCount: 10,
    revenuePaise: 2200000, // ₹22,000
    status: 'steady',
    reason: 'Consistent',
  },
];

describe('PractitionerPerformanceTable', () => {
  it('renders practitioner initials, names, status badges, and visit counts', () => {
    render(<PractitionerPerformanceTable rows={mockRows} />);

    // Initials for Dr. Anita Sharma should be AS
    expect(screen.getByText('AS')).toBeInTheDocument();
    expect(screen.getByText('Dr. Anita Sharma')).toBeInTheDocument();
    expect(screen.getByText('Strong')).toBeInTheDocument();

    // Initials for Vikram Mehta should be VM
    expect(screen.getByText('VM')).toBeInTheDocument();
    expect(screen.getByText('Vikram Mehta')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();

    // Visit counts
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('renders inline progress bars matching utilisation percentages', () => {
    render(<PractitionerPerformanceTable rows={mockRows} />);

    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('42%*')).toBeInTheDocument(); // with * for usesClinicHours

    // Progress bar elements
    const progressBars = screen.getAllByRole('progressbar');
    expect(progressBars.length).toBe(3);
    expect(progressBars[0]).toHaveAttribute('aria-valuenow', '75');
  });

  it('formats revenue correctly in Indian Rupees', () => {
    render(<PractitionerPerformanceTable rows={mockRows} />);

    expect(screen.getByText('₹35,000')).toBeInTheDocument();
    expect(screen.getByText('₹14,000')).toBeInTheDocument();
    expect(screen.getByText('₹22,000')).toBeInTheDocument();
  });

  it('sorts columns when column headers are clicked', () => {
    render(<PractitionerPerformanceTable rows={mockRows} />);

    // Default sort is utilisation descending: Anita (75%), Pooja (58%), Vikram (42%)
    let names = screen.getAllByTestId('therapist-name').map((el) => el.textContent);
    expect(names[0]).toContain('Dr. Anita Sharma');
    expect(names[1]).toContain('Pooja Roy');
    expect(names[2]).toContain('Vikram Mehta');

    // Click Revenue header to sort by revenue
    const revenueHeader = screen.getByRole('button', { name: /Revenue/i });
    fireEvent.click(revenueHeader);

    // Should sort descending by revenue: Anita (35k), Pooja (22k), Vikram (14k)
    names = screen.getAllByTestId('therapist-name').map((el) => el.textContent);
    expect(names[0]).toContain('Dr. Anita Sharma');
    expect(names[2]).toContain('Vikram Mehta');

    // Click again to sort ascending by revenue: Vikram (14k), Pooja (22k), Anita (35k)
    fireEvent.click(revenueHeader);
    names = screen.getAllByTestId('therapist-name').map((el) => el.textContent);
    expect(names[0]).toContain('Vikram Mehta');
    expect(names[2]).toContain('Dr. Anita Sharma');
  });

  it('calls onSelectTherapist when clicking a row', () => {
    const onSelect = vi.fn();
    render(<PractitionerPerformanceTable rows={mockRows} onSelectTherapist={onSelect} />);

    const row = screen.getByText('Vikram Mehta').closest('tr');
    expect(row).toBeTruthy();
    if (row) fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledWith('t-2');
  });
});
