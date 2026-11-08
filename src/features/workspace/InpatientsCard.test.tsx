// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { Admission, Patient, Visit } from '@/domain/types';
import { toLocalDateStr } from '@/domain/schedule';

const clinicRef: { current: { id: string; careLocations: string[] } } = { current: { id: 'c', careLocations: ['clinic', 'ward'] } };
const planAllows = { current: true };
const dataRef: { current: { stays: Admission[]; patients: Patient[]; visits: Visit[] } | null | undefined } = { current: undefined };

vi.mock('@/app/clinicContext', () => ({ useClinic: () => clinicRef.current }));
vi.mock('@/app/useEntitlements', () => ({ useEntitlements: () => ({ can: () => planAllows.current }) }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => dataRef.current }));
vi.mock('@/services', () => ({ repos: {} }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, search, children, className }: { to: string; params?: object; search?: object; children: React.ReactNode; className?: string }) => (
    <a href={to} data-params={JSON.stringify(params ?? {})} data-search={JSON.stringify(search ?? {})} className={className}>{children}</a>
  ),
}));
vi.mock('@/features/patients/AddPatientSheet', () => ({ AddPatientSheet: () => null }));
vi.mock('@/features/patients/AdmissionSheet', () => ({ AdmissionSheet: () => null }));
vi.mock('./AdmitPatientPicker', () => ({ AdmitPatientPicker: () => null }));

import { InpatientsCard } from './InpatientsCard';

const today = toLocalDateStr(new Date());
const stay = (id: string, patientId: string, over: Partial<Admission> = {}): Admission => ({
  id, clinicId: 'c', patientId, ipdNo: null, wardBed: null, admittingDoctor: null,
  admittedOn: today, dischargedOn: null, notes: null, deleted: false, updatedAt: '', ...over,
});
const patient = (id: string, name: string) => ({ id, clinicId: 'c', name, mrno: id } as unknown as Patient);
const visit = (id: string, admissionId: string, visitDate: string) =>
  ({ id, admissionId, visitDate, deleted: false } as unknown as Visit);

describe('InpatientsCard', () => {
  beforeEach(() => {
    clinicRef.current = { id: 'c', careLocations: ['clinic', 'ward'] };
    planAllows.current = true;
    dataRef.current = undefined;
  });
  afterEach(cleanup);

  it('shows nothing for a clinic without Inpatient on', () => {
    clinicRef.current = { id: 'c', careLocations: ['clinic'] };
    dataRef.current = null;
    const { container } = render(<InpatientsCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a loading state, not "nobody admitted", until the data is in', () => {
    render(<InpatientsCard />);
    expect(screen.getByRole('status', { name: 'Loading inpatients' })).toBeInTheDocument();
    expect(screen.queryByText(/Nobody is admitted/)).toBeNull();
  });

  it('groups by ward, shows the day of stay and seen today, and links Log session to that stay', () => {
    dataRef.current = {
      stays: [
        stay('s1', 'p1', { wardBed: 'Ortho ward, bed 2', admittedOn: today }),
        stay('s2', 'p2', { wardBed: 'ICU, bed 1', ipdNo: '77' }),
      ],
      patients: [patient('p1', 'Asha'), patient('p2', 'Ravi')],
      visits: [visit('v1', 's1', today), visit('v0', 's1', '2020-01-01')],
    };
    render(<InpatientsCard />);
    const ortho = screen.getByRole('region', { name: 'Ortho ward' });
    expect(within(ortho).getByText('Asha')).toBeInTheDocument();
    expect(within(ortho).getByText(/Seen today/)).toBeInTheDocument();
    expect(within(ortho).getByText(/Day 1/)).toBeInTheDocument();
    const log = within(ortho).getByRole('link', { name: '+ Log another session' });
    expect(JSON.parse(log.getAttribute('data-search')!)).toMatchObject({ patientId: 'p1', admissionId: 's1', from: '/workspace', repeatVisitId: 'v1' });

    const icu = screen.getByRole('region', { name: 'ICU' });
    expect(within(icu).queryByText(/Seen today/)).toBeNull();
    const first = within(icu).getByRole('link', { name: '+ Log session' });
    expect(JSON.parse(first.getAttribute('data-search')!)).toEqual({ patientId: 'p2', admissionId: 's2', from: '/workspace' });
    expect(screen.getByRole('button', { name: '+ Admit patient' })).toBeInTheDocument();
  });

  it('a plan without inpatient keeps showing who is already admitted but offers no Admit button', () => {
    planAllows.current = false;
    dataRef.current = { stays: [stay('s1', 'p1')], patients: [patient('p1', 'Asha')], visits: [] };
    render(<InpatientsCard />);
    expect(screen.getByText('Asha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Admit patient' })).toBeNull();
  });
});
