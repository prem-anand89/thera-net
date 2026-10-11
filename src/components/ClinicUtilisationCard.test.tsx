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
const bucket = (key: string, label: string, clinic: number, rows: BucketReport['rows']): BucketReport => ({
  bucket: { key, label, from: '2026-01-01', to: '2026-01-31' },
  clinicRatio: clinic,
  rows,
});
const row = (id: string, name: string, ratio: number | null, visitCount = 40, clinicHours = false) => ({
  therapistId: id,
  name,
  visitCount,
  utilisation: util(ratio, clinicHours),
});

const report: BucketReport[] = [
  bucket('sep', "Sep '26", 0.6, [row('a', 'Priya', 0.62), row('b', 'Kiran', 0.58)]),
  bucket('oct', "Oct '26", 0.55, [row('a', 'Priya', 0.8), row('b', 'Kiran', 0.3, 40, true), row('c', 'Newbie', 0.5, 4)]),
];

describe('ClinicUtilisationView', () => {
  it('shows a bar per period and the latest period’s therapists, best first', () => {
    render(<ClinicUtilisationView report={report} granularity="month" onGranularityChange={() => {}} />);
    expect(screen.getByRole('button', { name: "Oct '26: 55% utilisation" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Sep '26: 60% utilisation" })).toBeInTheDocument();
    const names = screen.getAllByRole('row').slice(1).map((r) => r.textContent ?? '');
    expect(names[0]).toContain('Priya');
    expect(names[1]).toContain('Newbie');
    expect(names[2]).toContain('Kiran');
  });

  it('flags strong, needs-attention and not-enough-data therapists', () => {
    render(<ClinicUtilisationView report={report} granularity="month" onGranularityChange={() => {}} />);
    expect(screen.getByText('Strong')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Not enough data')).toBeInTheDocument();
  });

  it('shows the change from the previous period and the clinic-hours footnote', () => {
    render(<ClinicUtilisationView report={report} granularity="month" onGranularityChange={() => {}} />);
    expect(screen.getByText('+18 pts')).toBeInTheDocument(); // Priya 62% → 80%
    expect(screen.getByText(/No personal working hours set/)).toBeInTheDocument();
  });

  it('switches the table to the period whose bar is clicked', () => {
    render(<ClinicUtilisationView report={report} granularity="month" onGranularityChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: "Sep '26: 60% utilisation" }));
    expect(screen.getByRole('heading', { name: /clinic 60%/ })).toBeInTheDocument();
    expect(screen.queryByText('Newbie')).not.toBeInTheDocument();
  });

  it('reports the chosen granularity', () => {
    const onChange = vi.fn();
    render(<ClinicUtilisationView report={report} granularity="month" onGranularityChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quarterly' }));
    expect(onChange).toHaveBeenCalledWith('quarter');
  });

  it('shows an empty state when nothing has been logged', () => {
    render(
      <ClinicUtilisationView
        report={[bucket('x', 'X', 0, [row('a', 'Priya', 0, 0)])]}
        granularity="month"
        onGranularityChange={() => {}}
      />
    );
    expect(screen.getByText(/No visits logged/)).toBeInTheDocument();
  });
});
