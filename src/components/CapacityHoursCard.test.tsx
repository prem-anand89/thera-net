// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { CapacityHoursCard } from './CapacityHoursCard';
import type { BucketReport } from '@/domain/utilisationReport';

afterEach(cleanup);

const mockReports: BucketReport[] = [
  {
    bucket: { key: 'sep', label: 'Sep 26', from: '2026-09-01', to: '2026-09-30' },
    clinicRatio: 0.55,
    clinicWorkedMinutes: 2400, // 40 hrs
    clinicAvailableMinutes: 4800, // 80 hrs
    clinicRevenuePaise: 25000000,
    priorClinicRatio: null,
    priorClinicWorkedMinutes: null,
    priorClinicAvailableMinutes: null,
    priorClinicRevenuePaise: null,
    rows: [],
  },
  {
    bucket: { key: 'oct', label: 'Oct 26', from: '2026-10-01', to: '2026-10-31' },
    clinicRatio: 0.72,
    clinicWorkedMinutes: 3600, // 60 hrs
    clinicAvailableMinutes: 4800, // 80 hrs
    clinicRevenuePaise: 42000000,
    priorClinicRatio: 0.55,
    priorClinicWorkedMinutes: 2400,
    priorClinicAvailableMinutes: 4800,
    priorClinicRevenuePaise: 25000000,
    rows: [],
  },
];

describe('CapacityHoursCard', () => {
  it('renders headline booked hours, total capacity subtitle, and volume bars', () => {
    render(
      <CapacityHoursCard
        reports={mockReports}
        activeIndex={1}
        onSelectBucket={vi.fn()}
        compareMode={false}
      />
    );

    expect(screen.getByText(/Capacity & Work Hours/i)).toBeInTheDocument();
    expect(screen.getByText(/60 hrs/i)).toBeInTheDocument();
    expect(screen.getByText(/of 80 hrs total capacity/i)).toBeInTheDocument();
    expect(screen.getAllByText('Oct 26').length).toBeGreaterThan(0);
  });

  it('renders compare delta in hours when compareMode is active', () => {
    render(
      <CapacityHoursCard
        reports={mockReports}
        activeIndex={1}
        onSelectBucket={vi.fn()}
        compareMode={true}
      />
    );

    expect(screen.getByText(/\+20 hrs vs prior/i)).toBeInTheDocument();
  });

  it('allows clicking a volume bar to select that period and hovering shows tooltip', () => {
    const onSelectBucket = vi.fn();
    render(
      <CapacityHoursCard
        reports={mockReports}
        activeIndex={1}
        onSelectBucket={onSelectBucket}
        compareMode={false}
      />
    );

    const bar = screen.getByRole('button', { name: /Sep 26: 40 hrs/i });
    fireEvent.mouseEnter(bar);
    expect(screen.getAllByText(/Sep 26: 40 hrs/i).length).toBeGreaterThan(0);

    fireEvent.click(bar);
    expect(onSelectBucket).toHaveBeenCalledWith(0);
  });
});
