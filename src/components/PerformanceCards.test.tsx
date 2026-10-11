// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { UtilisationTrendCard } from './UtilisationTrendCard';
import { RevenueVolumeCard } from './RevenueVolumeCard';
import type { BucketReport } from '@/domain/utilisationReport';

afterEach(cleanup);

const mockReports: BucketReport[] = [
  {
    bucket: { key: 'sep', label: 'Sep 26', from: '2026-09-01', to: '2026-09-30' },
    clinicRatio: 0.55,
    clinicRevenuePaise: 25000000,
    clinicWorkedMinutes: 3300,
    clinicAvailableMinutes: 6000,
    priorClinicRatio: null,
    priorClinicRevenuePaise: null,
    priorClinicWorkedMinutes: null,
    priorClinicAvailableMinutes: null,
    rows: [],
  },
  {
    bucket: { key: 'oct', label: 'Oct 26', from: '2026-10-01', to: '2026-10-31' },
    clinicRatio: 0.72,
    clinicRevenuePaise: 42000000,
    clinicWorkedMinutes: 4320,
    clinicAvailableMinutes: 6000,
    priorClinicRatio: 0.55,
    priorClinicRevenuePaise: 25000000,
    priorClinicWorkedMinutes: 3300,
    priorClinicAvailableMinutes: 6000,
    rows: [],
  },
];

describe('UtilisationTrendCard', () => {
  it('renders headline percentage, period sub-badge, and target line', () => {
    render(
      <UtilisationTrendCard
        reports={mockReports}
        activeIndex={1}
        onSelectBucket={vi.fn()}
        compareMode={false}
      />
    );

    expect(screen.getByText('Utilisation')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getAllByText('Oct 26').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Target 70%/i).length).toBeGreaterThan(0);
  });

  it('renders compare delta when compareMode is active', () => {
    render(
      <UtilisationTrendCard
        reports={mockReports}
        activeIndex={1}
        onSelectBucket={vi.fn()}
        compareMode={true}
      />
    );

    expect(screen.getByText(/\+17 pts vs prior/i)).toBeInTheDocument();
  });

  it('allows clicking a bucket point to select that period', () => {
    const onSelectBucket = vi.fn();
    render(
      <UtilisationTrendCard
        reports={mockReports}
        activeIndex={1}
        onSelectBucket={onSelectBucket}
        compareMode={false}
      />
    );

    const point = screen.getByRole('button', { name: /Sep 26: 55%/i });
    fireEvent.click(point);
    expect(onSelectBucket).toHaveBeenCalledWith(0);
  });
});

describe('RevenueVolumeCard', () => {
  it('renders formatted headline revenue, subtitle, and volume bars', () => {
    render(
      <RevenueVolumeCard
        reports={mockReports}
        activeIndex={1}
        onSelectBucket={vi.fn()}
        compareMode={false}
      />
    );

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('₹4,20,000')).toBeInTheDocument();
    expect(screen.getAllByText('Oct 26').length).toBeGreaterThan(0);
  });

  it('renders compare delta in revenue when compareMode is active', () => {
    render(
      <RevenueVolumeCard
        reports={mockReports}
        activeIndex={1}
        onSelectBucket={vi.fn()}
        compareMode={true}
      />
    );

    expect(screen.getByText(/\+₹1,70,000 vs prior/i)).toBeInTheDocument();
  });

  it('allows clicking a revenue bar to select that period', () => {
    const onSelectBucket = vi.fn();
    render(
      <RevenueVolumeCard
        reports={mockReports}
        activeIndex={1}
        onSelectBucket={onSelectBucket}
        compareMode={false}
      />
    );

    const bar = screen.getByRole('button', { name: /Sep 26: ₹2,50,000/i });
    fireEvent.click(bar);
    expect(onSelectBucket).toHaveBeenCalledWith(0);
  });
});
