// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TherapistComparisonTable, type TherapistComparisonRow } from './TherapistComparisonTable';

afterEach(cleanup);

const row = (over: Partial<TherapistComparisonRow> = {}): TherapistComparisonRow => ({
  therapistName: 'Priya',
  billPaise: 100000,
  postTaxPaise: 0,
  netPostTaxPaise: 80000,
  visitCount: 12,
  patientsTreated: 12,
  retentionPct: 50,
  newPackages: 1,
  ...over,
});

describe('TherapistComparisonTable utilisation column', () => {
  it('is hidden when no row carries utilisation', () => {
    render(<TherapistComparisonTable rows={[row()]} showPostTax={false} ownLabel="BM" />);
    expect(screen.queryByText('Utilisation')).not.toBeInTheDocument();
  });

  it('shows a rounded percentage and a dash when nothing was available', () => {
    render(
      <TherapistComparisonTable
        rows={[row({ utilisation: 0.724 }), row({ therapistName: 'Kiran', utilisation: null })]}
        showPostTax={false}
        ownLabel="BM"
      />
    );
    expect(screen.getByText('Utilisation')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('marks clinic-hours fallbacks with an asterisk and a footnote', () => {
    render(
      <TherapistComparisonTable
        rows={[row({ utilisation: 0.5, utilisationClinicHours: true })]}
        showPostTax={false}
        ownLabel="BM"
      />
    );
    expect(screen.getByText('50%*')).toBeInTheDocument();
    expect(screen.getByText(/No personal working hours set/)).toBeInTheDocument();
  });

  it('renders a progress bar for utilisation in row and in the total footer', () => {
    render(
      <TherapistComparisonTable
        rows={[row({ utilisation: 0.724 })]}
        total={row({ therapistName: 'Total', utilisation: 0.65 })}
        showPostTax={false}
        ownLabel="BM"
      />
    );
    const progressBars = screen.getAllByRole('progressbar');
    expect(progressBars.length).toBe(2);
    expect(progressBars[0]).toHaveAttribute('aria-valuenow', '72');
    expect(progressBars[1]).toHaveAttribute('aria-valuenow', '65');
  });
});

describe('TherapistComparisonTable ranking', () => {
  const two = [
    row({ therapistName: 'Priya', visitCount: 25, patientsTreated: 25, netPostTaxPaise: 5000 }),
    row({ therapistName: 'Kiran', visitCount: 40, patientsTreated: 40, netPostTaxPaise: 3000 }),
  ];

  it('marks the leader of each column and explains the minimum', () => {
    render(<TherapistComparisonTable rows={two} showPostTax={false} ownLabel="BM" />);
    expect(screen.getAllByText('Top').length).toBeGreaterThan(0);
    expect(screen.getByText(/at least 20 visits/)).toBeInTheDocument();
  });

  it('shows no marks when only one therapist is eligible', () => {
    render(
      <TherapistComparisonTable
        rows={[two[0], row({ therapistName: 'New', visitCount: 3, patientsTreated: 3 })]}
        showPostTax={false}
        ownLabel="BM"
      />
    );
    expect(screen.queryByText('Top')).not.toBeInTheDocument();
  });

  it('re-orders rows when a column header is clicked and restores on a second click', () => {
    render(<TherapistComparisonTable rows={two} showPostTax={false} ownLabel="BM" />);
    const names = () => screen.getAllByRole('row').slice(1).map((r) => r.textContent?.slice(0, 5));
    expect(names()[0]).toBe('Priya');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Visits' }));
    expect(names()[0]).toBe('Kiran');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Visits' }));
    expect(names()[0]).toBe('Priya');
  });
});
