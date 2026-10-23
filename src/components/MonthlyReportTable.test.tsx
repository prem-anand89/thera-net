// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MonthlyReportTable } from './MonthlyReportTable';
import type { MonthlyReport, TherapistMonthRow } from '@/services/reportService';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

afterEach(cleanup);

const row = (over: Partial<TherapistMonthRow>): TherapistMonthRow => ({
  therapistId: 't1',
  therapistName: 'Dr Prem',
  billPaise: 130000,
  clinicSharePaise: 97500,
  tdsPaise: 9750,
  postTaxPaise: 87750,
  partnerSharePaise: 32500,
  adjustmentPaise: 0,
  sharedPaise: -43300,
  netClinicSharePaise: 65000,
  netPostTaxPaise: 58500,
  visitCount: 1,
  patientsTreated: 1,
  assistedVisitCount: 0,
  billedSessionCount: 1,
  uniquePatients: 1,
  ...over,
});
const report = (rows: TherapistMonthRow[]): MonthlyReport =>
  ({ rows, total: row({ therapistId: 'total', therapistName: 'Total', visitCount: 1, patientsTreated: 1, assistedVisitCount: 0, sharedPaise: 0 }) }) as unknown as MonthlyReport;

const assistant = row({
  therapistId: 't2',
  therapistName: 'Dr Ravi',
  billPaise: 0,
  clinicSharePaise: 0,
  tdsPaise: 0,
  postTaxPaise: 0,
  partnerSharePaise: 0,
  sharedPaise: 43300,
  netClinicSharePaise: 32475,
  netPostTaxPaise: 29228,
  visitCount: 0,
  patientsTreated: 1,
  assistedVisitCount: 1,
});

describe('MonthlyReportTable assisted column', () => {
  it('monthly table shows assisted count and unchanged billed columns', () => {
    render(<MonthlyReportTable report={report([row({}), assistant])} showShared />);
    expect(screen.getByText('Assisted')).toBeInTheDocument();
    const ravi = screen.getByText('Dr Ravi').closest('tr') as HTMLElement;
    const cells = within(ravi).getAllByRole('cell').map((c) => c.textContent);
    // Billed-under-my-name columns stay at zero for the assistant; Visits stays 0; Assisted is 1.
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    const col = (name: string) => heads.findIndex((h) => h.startsWith(name));
    expect(cells[col('Bill Amount')]).toBe('₹0');
    expect(cells[col('Visits')]).toBe('0');
    expect(cells[col('Assisted')]).toBe('1');
    expect(col('Assisted')).toBe(col('Visits') + 1);
    const prem = screen.getByText('Dr Prem').closest('tr') as HTMLElement;
    expect(within(prem).getAllByRole('cell')[1].textContent).toBe('₹1,300');
    expect(
      screen.getByText("Total counts each visit once; therapists' patients treated can add up to more.")
    ).toBeInTheDocument();
  });

  it('hides the Assisted column and note when nobody assisted', () => {
    render(<MonthlyReportTable report={report([row({})])} />);
    expect(screen.queryByText('Assisted')).toBeNull();
    expect(screen.queryByText(/counts each visit once/)).toBeNull();
  });
});
