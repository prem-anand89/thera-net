// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BillTotals, DocFieldList, PrintLetterhead, PrintSignatureFooter } from './printChrome';

afterEach(cleanup);

const clinic = {
  name: 'Clinic',
  tagline: null,
  address: 'Addr',
  phone: '123',
  email: 'a@b.c',
  gstNo: null,
  hasPartner: false,
  partnerHospitalName: null,
};

describe('PrintLetterhead', () => {
  it('shows the partner and the tagline only when the clinic has them', () => {
    const { rerender } = render(<PrintLetterhead clinic={clinic} logoUrl={null} partnerLogoUrl={null} />);
    expect(screen.queryByText(/In partnership with/i)).toBeNull();
    rerender(
      <PrintLetterhead clinic={{ ...clinic, tagline: 'Sports rehab', hasPartner: true, partnerHospitalName: 'Partner' }} logoUrl={null} partnerLogoUrl={null} />
    );
    expect(screen.getByText(/In partnership with/i)).toBeInTheDocument();
    expect(screen.getByText('Partner')).toBeInTheDocument();
    expect(screen.getByText('Sports rehab')).toBeInTheDocument();
  });

  it('prints no partner once partner mode is off, even though Settings keeps the name', () => {
    render(
      <PrintLetterhead clinic={{ ...clinic, hasPartner: false, partnerHospitalName: 'Healthvalley' }} logoUrl={null} partnerLogoUrl="/p.png" />
    );
    expect(screen.queryByText(/In partnership with/i)).toBeNull();
    expect(screen.queryByText('Healthvalley')).toBeNull();
  });

  it('drops the partner logo but keeps the name on A5', () => {
    const { container } = render(
      <PrintLetterhead clinic={{ ...clinic, hasPartner: true, partnerHospitalName: 'Partner' }} logoUrl={null} partnerLogoUrl="/p.png" compact />
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
        ledger={{ rows: [{ date: '2026-11-06', mode: 'UPI', reference: 'UTR 4093 8821', amountPaise: 150000 }], grossPaise: 200000, paidPaise: 150000, balancePaise: 50000, excessPaise: 0 }}
      />
    );
    expect(screen.getByText('Payment details')).toBeInTheDocument();
    expect(screen.getByText('UPI')).toBeInTheDocument();
    expect(screen.getByText('UTR 4093 8821')).toBeInTheDocument();
    expect(screen.getByText('Balance Due')).toBeInTheDocument();
    expect(screen.queryByText('Subtotal')).toBeNull();
  });

  it('shows the subtotal only with an adjustment, and says when nothing is paid', () => {
    render(
      <BillTotals
        subtotalPaise={200000}
        adjustmentPaise={-10000}
        totalPaise={190000}
        ledger={{ rows: [], grossPaise: 190000, paidPaise: 0, balancePaise: 190000, excessPaise: 0 }}
      />
    );
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('No payment recorded yet')).toBeInTheDocument();
  });
});

describe('BillTotals: more cases', () => {
  const base = { subtotalPaise: 150000, adjustmentPaise: 0, totalPaise: 150000 };
  it('shows what was received beyond the bill', () => {
    render(<BillTotals {...base} ledger={{ rows: [{ date: '2026-11-06', mode: 'Cash', reference: null, amountPaise: 200000 }], grossPaise: 150000, paidPaise: 200000, balancePaise: 0, excessPaise: 50000 }} />);
    expect(screen.getByText('Excess received')).toBeInTheDocument();
  });
  it('lists several payments and an advance with its receipt', () => {
    render(
      <BillTotals
        {...base}
        ledger={{
          rows: [
            { date: '2026-11-01', mode: 'Advance', reference: 'ADV-20261101-A1B2C3', amountPaise: 100000 },
            { date: '2026-11-06', mode: 'Card', reference: null, amountPaise: 50000 },
          ],
          grossPaise: 150000,
          paidPaise: 150000,
          balancePaise: 0,
          excessPaise: 0,
        }}
      />
    );
    expect(screen.getByText('Advance')).toBeInTheDocument();
    expect(screen.getByText('ADV-20261101-A1B2C3')).toBeInTheDocument();
    expect(screen.queryByText('Excess received')).toBeNull();
  });
  it('has no fill on the Total row (it must read the same on a black-and-white printer)', () => {
    const { container } = render(<BillTotals {...base} />);
    expect(container.innerHTML).not.toMatch(/bg-\[var\(--doc-fill/);
  });
});

describe('PrintSignatureFooter', () => {
  it('falls back to a blank line when the signature image cannot be loaded', () => {
    const { container } = render(<PrintSignatureFooter left={null} signatureUrl="/gone.png" />);
    const img = container.querySelector('img')!;
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Authorised signature')).toBeInTheDocument();
  });
  it('prints the signer under the line when given', () => {
    render(<PrintSignatureFooter left={null} signatureUrl={null} signerName="Dr Sample · Reg. 1" />);
    expect(screen.getByText('Dr Sample · Reg. 1')).toBeInTheDocument();
  });
});

describe('DocFieldList', () => {
  it('prints label : value rows', () => {
    render(<DocFieldList rows={[{ label: 'Phone', value: '123' }]} />);
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText(': 123')).toBeInTheDocument();
  });
});
