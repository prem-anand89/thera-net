// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PaymentStatusDisplay } from './VisitPaymentDisplay';
import type { VisitCardData } from './types';

afterEach(cleanup);

const unpaid = {
  paymentState: 'uninvoiced',
  billPaise: 50000,
  collectedPaise: 0,
  visitDate: '2026-10-20',
  issuedAt: null,
  invoiceId: null,
  sessionIndex: null,
  packageTotal: null,
  packageInvoicePending: false,
} as unknown as VisitCardData;

describe('PaymentStatusDisplay', () => {
  it('lets a plan without invoicing collect, and does not send them to a billing desk', () => {
    render(<PaymentStatusDisplay data={unpaid} canInvoice={false} canCollect onTakePayment={() => {}} />);
    expect(screen.getByRole('button', { name: /Collect/ })).toBeInTheDocument();
    expect(screen.queryByText('Ask billing')).not.toBeInTheDocument();
  });

  it('still says "Ask billing" when the user can neither invoice nor collect', () => {
    render(<PaymentStatusDisplay data={unpaid} canInvoice={false} canCollect={false} />);
    expect(screen.queryByRole('button', { name: /Collect/ })).not.toBeInTheDocument();
    expect(screen.getByText('Ask billing')).toBeInTheDocument();
  });
});
