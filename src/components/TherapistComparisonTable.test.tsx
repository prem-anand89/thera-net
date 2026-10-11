// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TherapistComparisonTable, type TherapistComparisonRow } from './TherapistComparisonTable';

afterEach(cleanup);

const row = (over: Partial<TherapistComparisonRow> = {}): TherapistComparisonRow => ({
  therapistName: 'Priya',
  billPaise: 100000,
  postTaxPaise: 0,
  netPostTaxPaise: 80000,
  visitCount: 12,
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
});
