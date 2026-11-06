// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BillTotals, PrintLetterhead } from './printChrome';

afterEach(cleanup);

const clinic = {
  name: 'Clinic',
  tagline: null,
  address: 'Addr',
  phone: '123',
  email: 'a@b.c',
  gstNo: null,
  partnerHospitalName: null,
};

describe('PrintLetterhead', () => {
  it('shows the partner and the tagline only when the clinic has them', () => {
    const { rerender } = render(<PrintLetterhead clinic={clinic} logoUrl={null} partnerLogoUrl={null} />);
    expect(screen.queryByText(/In partnership with/i)).toBeNull();
    rerender(
      <PrintLetterhead clinic={{ ...clinic, tagline: 'Sports rehab', partnerHospitalName: 'Partner' }} logoUrl={null} partnerLogoUrl={null} />
    );
    expect(screen.getByText(/In partnership with/i)).toBeInTheDocument();
    expect(screen.getByText('Partner')).toBeInTheDocument();
    expect(screen.getByText('Sports rehab')).toBeInTheDocument();
  });

  it('drops the partner logo but keeps the name on A5', () => {
    const { container } = render(
      <PrintLetterhead clinic={{ ...clinic, partnerHospitalName: 'Partner' }} logoUrl={null} partnerLogoUrl="/p.png" compact />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Partner')).toBeInTheDocument();
  });
});

describe('BillTotals', () => {
  it('lists payments beside Amount Paid and Balance Due', () => {
    render(
      <BillTotals
        subtotalPaise={200000}
        adjustmentPaise={0}
        totalPaise={200000}
        ledger={{ rows: [{ date: '2026-11-06', mode: 'UPI', amountPaise: 150000 }], paidPaise: 150000, balancePaise: 50000 }}
      />
    );
    expect(screen.getByText('Payment details')).toBeInTheDocument();
    expect(screen.getByText('UPI')).toBeInTheDocument();
    expect(screen.getByText('Balance Due')).toBeInTheDocument();
    expect(screen.queryByText('Subtotal')).toBeNull();
  });

  it('shows the subtotal only with an adjustment, and says when nothing is paid', () => {
    render(
      <BillTotals
        subtotalPaise={200000}
        adjustmentPaise={-10000}
        totalPaise={190000}
        ledger={{ rows: [], paidPaise: 0, balancePaise: 190000 }}
      />
    );
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('No payment recorded yet')).toBeInTheDocument();
  });
});
