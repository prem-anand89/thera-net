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
  patientsTreated: visitCount,
  assistedVisitCount: 0,
  revenuePaise,
  utilisation: util(ratio, clinicHours),
});

const report: BucketReport[] = [
  {
    bucket: { key: 'sep', label: 'Sep 26', from: '2026-09-01', to: '2026-09-30' },
    clinicRatio: 0.6,
    clinicWorkedMinutes: 576,
    clinicAvailableMinutes: 960,
    clinicRevenuePaise: 10000000,
    priorClinicRatio: null,
    priorClinicWorkedMinutes: null,
    priorClinicAvailableMinutes: null,
    priorClinicRevenuePaise: null,
    rows: [row('a', 'Priya', 0.62, 35, 4500000), row('b', 'Kiran', 0.58, 30, 4000000)],
  },
  {
    bucket: { key: 'oct', label: 'Oct 26', from: '2026-10-01', to: '2026-10-31' },
    clinicRatio: 0.55,
    clinicWorkedMinutes: 768,
    clinicAvailableMinutes: 1440,
    clinicRevenuePaise: 13500000,
    priorClinicRatio: 0.6,
    priorClinicWorkedMinutes: 576,
    priorClinicAvailableMinutes: 960,
    priorClinicRevenuePaise: 10000000,
    rows: [
      row('a', 'Priya', 0.8, 45, 6000000),
      row('b', 'Kiran', 0.3, 20, 2500000, true),
      row('c', 'Newbie', 0.5, 4, 500000),
    ],
  },
];

describe('ClinicUtilisationView (Splose-inspired redesign)', () => {
  it('renders top filter bar and dual KPI cards', () => {
    render(<ClinicUtilisationView report={report} granularity="month" onGranularityChange={() => {}} />);

    // Filter bar elements
    expect(screen.getByRole('group', { name: /granularity/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /compare/i })).toBeInTheDocument();

    // Dual Hero Cards
    expect(screen.getByRole('heading', { name: 'Utilisation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Capacity & Work Hours' })).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument(); // Oct 26 utilisation
    expect(screen.getByText('12.8 hrs')).toBeInTheDocument(); // Oct 26 booked hours
    expect(screen.getByText(/of 24 hrs total capacity/i)).toBeInTheDocument();
  });

  it('reports the chosen granularity when clicking pill', () => {
    const onChange = vi.fn();
    render(<ClinicUtilisationView report={report} granularity="month" onGranularityChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '6m' }));
    expect(onChange).toHaveBeenCalledWith('6m');
  });

  it('switches the active period when clicking a point or bar in the KPI cards', () => {
    render(<ClinicUtilisationView report={report} granularity="month" onGranularityChange={() => {}} />);

    // Click Sep 26 point in utilisation card
    const sepPoint = screen.getByRole('button', { name: /Sep 26: 60%/i });
    fireEvent.click(sepPoint);

    // Headline should reflect Sep 26
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('filters charts by selected practitioner from filter bar dropdown', () => {
    render(<ClinicUtilisationView report={report} granularity="month" onGranularityChange={() => {}} />);

    const select = screen.getByRole('combobox', { name: 'Filter by practitioner' });
    fireEvent.change(select, { target: { value: 'a' } });

    // Chart titles update to reflect selected practitioner Priya
    expect(screen.getByRole('heading', { name: 'Priya Utilisation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Priya Work Hours' })).toBeInTheDocument();
  });

  it('shows an empty state when no visits are logged', () => {
    render(
      <ClinicUtilisationView
        report={[
          {
            bucket: { key: 'x', label: 'Empty', from: '2026-01-01', to: '2026-01-31' },
            clinicRatio: 0,
            clinicRevenuePaise: 0,
            clinicWorkedMinutes: 0,
            clinicAvailableMinutes: 0,
            priorClinicRatio: null,
            priorClinicRevenuePaise: null,
            priorClinicWorkedMinutes: null,
            priorClinicAvailableMinutes: null,
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
