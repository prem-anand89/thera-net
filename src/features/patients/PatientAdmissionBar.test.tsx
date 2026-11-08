// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Admission, Patient, Visit } from '@/domain/types';

const state: { stays: Admission[]; visits: Visit[]; canBill: boolean } = { stays: [], visits: [], canBill: true };
const invoiceDialog = vi.fn();

vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c', careLocations: ['clinic', 'ward'] }) }));
vi.mock('@/app/useEntitlements', () => ({ useEntitlements: () => ({ can: () => true }) }));
vi.mock('@/app/usePermissions', () => ({ usePermissions: () => ({ canBill: state.canBill }) }));
// The bar reads the patient's stays and the patient's visits through two live queries; tell them apart by the table they read.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (fn: () => unknown) => (fn.toString().includes('admissions') ? state.stays : state.visits) }));
vi.mock('@/services', () => ({ repos: {}, admissionService: {} }));
vi.mock('@/lib/notify', () => ({ askConfirm: vi.fn(), notify: { info: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/IssueInvoiceDialog', () => ({
  IssueInvoiceDialog: (props: { target: unknown }) => {
    invoiceDialog(props.target);
    return <div>invoice dialog</div>;
  },
}));
vi.mock('./AdmissionSheet', () => ({ AdmissionSheet: () => null }));
vi.mock('./DischargeSheet', () => ({ DischargeSheet: () => null }));

import { PatientAdmissionBar } from './PatientAdmissionBar';
import { notify } from '@/lib/notify';

const patient = { id: 'p', clinicId: 'c', name: 'Asha' } as unknown as Patient;
const stay = (over: Partial<Admission> = {}): Admission => ({
  id: 's1', clinicId: 'c', patientId: 'p', ipdNo: null, wardBed: 'Ortho, bed 2', admittingDoctor: null,
  admittedOn: '2026-11-01', dischargedOn: null, notes: null, deleted: false, updatedAt: '', ...over,
});
const visit = (id: string, over: Partial<Visit> = {}) =>
  ({ id, admissionId: 's1', actualBillPaise: 100000, invoiceId: null, deleted: false, ...over }) as unknown as Visit;

describe('PatientAdmissionBar billing', () => {
  beforeEach(() => {
    state.stays = [stay()];
    state.visits = [visit('v1'), visit('v2'), visit('billed', { invoiceId: 'i1' }), visit('gone', { deleted: true }), visit('other', { admissionId: 'x' })];
    state.canBill = true;
    invoiceDialog.mockClear();
  });
  afterEach(cleanup);

  it('"Bill this stay" bills exactly the stay\'s sessions that are not yet on a bill', () => {
    render(<PatientAdmissionBar patient={patient} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bill this stay' }));
    expect(invoiceDialog).toHaveBeenCalled();
    const target = invoiceDialog.mock.calls[0][0] as { visitIds: string[]; patientId: string; alreadyCollected: boolean };
    expect(target.visitIds.sort()).toEqual(['v1', 'v2']);
    expect(target.patientId).toBe('p');
    expect(target.alreadyCollected).toBe(false);
  });

  it('offers no billing without billing access, or when everything is already billed', () => {
    state.canBill = false;
    const { unmount } = render(<PatientAdmissionBar patient={patient} />);
    expect(screen.queryByRole('button', { name: 'Bill this stay' })).toBeNull();
    unmount();
    state.canBill = true;
    state.visits = [visit('billed', { invoiceId: 'i1' })];
    render(<PatientAdmissionBar patient={patient} />);
    expect(screen.queryByRole('button', { name: 'Bill this stay' })).toBeNull();
  });

  it('a stay whose sessions total nothing says so instead of opening an empty bill', () => {
    state.visits = [visit('free', { actualBillPaise: 0 })];
    render(<PatientAdmissionBar patient={patient} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bill this stay' }));
    expect(invoiceDialog).not.toHaveBeenCalled();
    expect(notify.info).toHaveBeenCalledWith('There is nothing to bill on this stay yet.');
  });

  it('after a discharge the stay can still be billed from the last-stay line', () => {
    state.stays = [stay({ dischargedOn: '2026-11-05' })];
    render(<PatientAdmissionBar patient={patient} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bill this stay' }));
    expect(invoiceDialog).toHaveBeenCalled();
  });
});
