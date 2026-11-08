// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, search }: { children: React.ReactNode; search?: unknown }) => (
    <a href="#bill" data-search={JSON.stringify(search)}>
      {children}
    </a>
  ),
}));

import { PatientInvoicesList } from './PatientInvoicesList';
import type { Invoice, PaymentStatus } from '@/domain/types';

afterEach(cleanup);

const inv = (id: string, invoiceNo: string, totalPaise = 100000) =>
  ({ id, invoiceNo, totalPaise, issuedAt: '2026-11-03T10:00:00Z', patientSnapshot: { name: 'Asha', mrno: 'P1' } }) as unknown as Invoice;

type Over = Partial<Parameters<typeof PatientInvoicesList>[0]>;
function renderList(over: Over = {}) {
  const onTakePayment = vi.fn();
  const onRemind = vi.fn();
  render(
    <PatientInvoicesList
      invoices={[inv('a', 'BM/26-27/0001')]}
      statusByInvoiceId={new Map<string, PaymentStatus>([['a', 'outstanding']])}
      recordedByInvoiceId={new Map()}
      supersededInvoiceIds={new Set()}
      visitIdByInvoiceId={new Map([['a', 'v1']])}
      patientId="p1"
      canCollect
      onTakePayment={onTakePayment}
      onRemind={onRemind}
      {...over}
    />
  );
  return { onTakePayment, onRemind };
}

// Each bill renders in both the phone cards and the table (one is hidden by CSS), so queries take the first match.
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]!;

describe('PatientInvoicesList', () => {
  it('shows an empty note when the patient has no bills', () => {
    renderList({ invoices: [] });
    expect(screen.getByText('No bills for this patient yet.')).toBeInTheDocument();
  });

  it('shows number, status, and Take payment / reminder for an outstanding bill', () => {
    const { onTakePayment, onRemind } = renderList();
    expect(screen.getAllByText('BM/26-27/0001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Outstanding').length).toBeGreaterThan(0);
    fireEvent.click(first('Take payment'));
    expect(onTakePayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    fireEvent.click(first('Send reminder'));
    expect(onRemind).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 100000);
  });

  it('shows collected and due for a partly paid bill', () => {
    renderList({ recordedByInvoiceId: new Map([['a', 40000]]) });
    expect(screen.getAllByText('Partially paid').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/collected · .* due/).length).toBeGreaterThan(0);
  });

  it('hides Take payment and the reminder without the right to collect', () => {
    renderList({ canCollect: false });
    expect(screen.queryByRole('button', { name: 'Take payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send reminder' })).not.toBeInTheDocument();
  });

  it('offers no payment on a paid bill, a superseded bill, or a bill whose visits were removed', () => {
    renderList({
      invoices: [inv('p', 'B1'), inv('s', 'B2'), inv('r', 'B3')],
      statusByInvoiceId: new Map<string, PaymentStatus>([
        ['p', 'paid'],
        ['s', 'outstanding'],
        ['r', 'outstanding'],
      ]),
      supersededInvoiceIds: new Set(['s']),
      visitIdByInvoiceId: new Map([
        ['p', 'v1'],
        ['s', 'v2'],
      ]),
    });
    expect(screen.queryByRole('button', { name: 'Take payment' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Superseded').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
  });

  it('opens the bill with the way back to this patient', () => {
    renderList();
    const link = screen.getAllByText('Print')[0]!.closest('a')!;
    expect(JSON.parse(link.getAttribute('data-search')!)).toEqual({ from: '/patients', patient: 'p1' });
  });
});
