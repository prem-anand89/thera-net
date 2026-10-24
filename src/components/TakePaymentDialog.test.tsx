// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (q: () => unknown) => q() }));
const logPayment = vi.fn();
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1', hasPartner: false, defaultPaymentMethod: 'cash' }) }));
vi.mock('@/services', () => ({
  repos: {
    invoices: { get: () => undefined },
    // useLiveQuery is mocked to run synchronously, so this thenable resolves inline.
    payments: { listByVisit: () => ({ then: (fn: (rows: never[]) => number) => fn([]) }) },
  },
  advanceService: { openAdvancesWithBalance: () => [] },
  paymentService: { invoiceBalance: () => undefined },
  directPaymentService: { logPayment: (...a: unknown[]) => logPayment(...a) },
}));
vi.mock('@/components/UpiQrModal', () => ({ ShowUpiQrButton: () => null }));

import { TakePaymentDialog } from './TakePaymentDialog';
import { toLocalDateStr } from '@/domain/schedule';

function open() {
  render(
    <TakePaymentDialog
      clinicId="c1"
      visitId="v1"
      invoiceId={null}
      amountPaise={50000}
      visitDate="2026-09-20"
      patientLabel="Ananya"
      mrno="W26-0001"
      onClose={() => {}}
    />
  );
}

describe('TakePaymentDialog received date', () => {
  beforeEach(() => logPayment.mockReset().mockResolvedValue(undefined));
  afterEach(cleanup);

  it('defaults to today even for a three-week-old visit', async () => {
    open();
    const today = toLocalDateStr(new Date());
    expect(screen.getByLabelText('Date received')).toHaveValue(today);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(logPayment).toHaveBeenCalledWith('c1', 'v1', 50000, 'cash', today, null);
  });

  it('records the date the user picks', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Date received'), { target: { value: '2026-10-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(logPayment).toHaveBeenCalledWith('c1', 'v1', 50000, 'cash', '2026-10-01', null);
  });
});
