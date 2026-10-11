// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ClinicUtilisationView } from './ClinicUtilisationCard';
import type { BucketReport } from '@/domain/utilisationReport';
import type { Utilisation } from '@/domain/utilisation';

afterEach(cleanup);

const util = (ratio: number | null, clinicHours = false): Utilisation => ({
  workedMinutes: (ratio ?? 0) * 480,
  availableMinutes: ratio == null ? 0 : 480,
  ratio,
  offHoursMinutes: 0,
  usesClinicHours: clinicHours,
});

const row = (
  id: string,
  name: string,
  ratio: number | null,
  visitCount = 40,
  revenuePaise = 5000000,
  clinicHours = false
) => ({
  therapistId: id,
  name,
  photoPath: null,
  visitCount,
  revenuePaise,
  utilisation: util(ratio, clinicHours),
});

const report: BucketReport[] = [
  {
    bucket: { key: 'sep', label: 'Sep 26', from: '2026-09-01', to: '2026-09-30' },
    clinicRatio: 0.6,
    clinicRevenuePaise: 10000000,
    priorClinicRatio: null,
    priorClinicRevenuePaise: null,
    rows: [row('a', 'Priya', 0.62, 35, 4500000), row('b', 'Kiran', 0.58, 30, 4000000)],
  },
  {
    bucket: { key: 'oct', label: 'Oct 26', from: '2026-10-01', to: '2026-10-31' },
    clinicRatio: 0.55,
    clinicRevenuePaise: 13500000,
    priorClinicRatio: 0.6,
    priorClinicRevenuePaise: 10000000,
    rows: [
      row('a', 'Priya', 0.8, 45, 6000000),
      row('b', 'Kiran', 0.3, 20, 2500000, true),
      row('c', 'Newbie', 0.5, 4, 500000),
    ],
  },
];

describe('ClinicUtilisationView (Splose-inspired redesign)', () => {
  it('renders top filter bar, dual KPI cards, and practitioner performance table', () => {
    render(<ClinicUtilisationView report={report} granularity="month" onGranularityChange={() => {}} />);

    // Filter bar elements
    expect(screen.getByRole('group', { name: /granularity/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /compare/i })).toBeInTheDocument();

    // Dual Hero Cards
    expect(screen.getByRole('heading', { name: 'Utilisation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Revenue' })).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument(); // Oct 26 utilisation
    expect(screen.getByText('₹1,35,000')).toBeInTheDocument(); // Oct 26 revenue

    // Practitioner table elements via test-id
    const names = screen.getAllByTestId('therapist-name').map((el) => el.textContent);
    expect(names).toContain('Priya');
    expect(names).toContain('Kiran');
    expect(names).toContain('Newbie');
    expect(screen.getByText('Strong')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('reports the chosen granularity when clicking pill', () => {
    const onChange = vi.fn();
    render(<ClinicUtilisationView report={report} granularity="month" onGranularityChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Quarterly' }));
    expect(onChange).toHaveBeenCalledWith('quarter');
  });

  it('switches the active period when clicking a point or bar in the KPI cards', () => {
    render(<ClinicUtilisationView report={report} granularity="month" onGranularityChange={() => {}} />);

    // Click Sep 26 point in utilisation card
    const sepPoint = screen.getByRole('button', { name: /Sep 26: 60%/i });
    fireEvent.click(sepPoint);

    // Headline and table should reflect Sep 26 (Priya & Kiran only, no Newbie)
    expect(screen.getByText('60%')).toBeInTheDocument();
    const names = screen.getAllByTestId('therapist-name').map((el) => el.textContent);
    expect(names).toContain('Priya');
    expect(names).toContain('Kiran');
    expect(names).not.toContain('Newbie');
  });

  it('filters table by selected practitioner from filter bar dropdown', () => {
    render(<ClinicUtilisationView report={report} granularity="month" onGranularityChange={() => {}} />);

    const select = screen.getByRole('combobox', { name: 'Filter by practitioner' });
    fireEvent.change(select, { target: { value: 'a' } });

    // Only Priya should be shown in table
    const names = screen.getAllByTestId('therapist-name').map((el) => el.textContent);
    expect(names).toContain('Priya');
    expect(names).not.toContain('Kiran');
    expect(names).not.toContain('Newbie');
  });

  it('shows an empty state when no visits are logged', () => {
    render(
      <ClinicUtilisationView
        report={[
          {
            bucket: { key: 'x', label: 'Empty', from: '2026-01-01', to: '2026-01-31' },
            clinicRatio: 0,
            clinicRevenuePaise: 0,
            priorClinicRatio: null,
            priorClinicRevenuePaise: null,
            rows: [],
          },
        ]}
        granularity="month"
        onGranularityChange={() => {}}
      />
    );

    expect(screen.getByText(/No visits logged in these periods yet/i)).toBeInTheDocument();
  });
});
