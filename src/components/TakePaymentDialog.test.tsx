// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (q: () => unknown) => q() }));
const logPayment = vi.fn();
const mockVisits = new Map<string, unknown>();
let mockOpenAdvances: unknown[] = [];
const applyAdvanceMock = vi.fn();

vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1', hasPartner: false }) }));
vi.mock('@/services', () => ({
  repos: {
    invoices: { get: () => undefined },
    visits: {
      get: (id: string) => {
        const v = mockVisits.get(id);
        return v ? Object.assign(Promise.resolve(v), v) : undefined;
      },
      list: async () => [...mockVisits.values()],
    },
    // useLiveQuery is mocked to run synchronously, so this thenable resolves inline.
    payments: { listByVisit: () => ({ then: (fn: (rows: never[]) => number) => fn([]) }) },
  },
  advanceService: {
    openAdvancesWithBalance: () => mockOpenAdvances,
    applyAdvance: (...a: unknown[]) => applyAdvanceMock(...a),
  },
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

// There is no clinic default payment method any more: a device starts from the method it used last.
beforeEach(() => window.localStorage.setItem('theranet:last-payment-method:c1', 'cash'));

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

describe('TakePaymentDialog advances department scoping', () => {
  beforeEach(() => {
    mockVisits.clear();
    mockOpenAdvances = [];
    applyAdvanceMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it('does not offer clinic advance for a ward visit, but offers and applies ward advance', async () => {
    mockVisits.set('v-ward', { id: 'v-ward', location: 'ward', actualBillPaise: 50000 });
    mockOpenAdvances = [
      { advance: { id: 'adv-op', department: 'clinic', receivedDate: '2026-08-01' }, remainingPaise: 50000 },
    ];

    const { unmount } = render(
      <TakePaymentDialog
        clinicId="c1"
        visitId="v-ward"
        invoiceId={null}
        patientId="p1"
        amountPaise={50000}
        visitDate="2026-09-20"
        patientLabel="Ananya"
        mrno="W26-0001"
        onClose={() => {}}
      />
    );

    // Clinic advance should NOT be available for a ward visit
    expect(screen.queryByText(/advance available/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    unmount();

    // Now test with ward advance
    mockOpenAdvances = [
      { advance: { id: 'adv-ward', department: 'ward', receivedDate: '2026-08-01' }, remainingPaise: 30000 },
    ];

    render(
      <TakePaymentDialog
        clinicId="c1"
        visitId="v-ward"
        invoiceId={null}
        patientId="p1"
        amountPaise={50000}
        visitDate="2026-09-20"
        patientLabel="Ananya"
        mrno="W26-0001"
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/₹300 advance available/i)).toBeInTheDocument();
    const applyBtn = screen.getByRole('button', { name: 'Apply' });
    expect(applyBtn).toBeInTheDocument();
    await userEvent.click(applyBtn);
    expect(applyAdvanceMock).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ id: 'adv-ward', department: 'ward' }),
      [expect.objectContaining({ id: 'v-ward' })],
      30000,
      expect.any(String)
    );
  });
});
