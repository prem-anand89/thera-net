// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Admission, Appointment, Patient, Therapist, Visit } from '@/domain/types';
import { toLocalDateStr } from '@/domain/schedule';

const clinicRef: { current: { id: string; careLocations: string[]; ipBilledByPartner?: boolean } } = {
  current: { id: 'c', careLocations: ['clinic', 'ward'] },
};
const planAllows = { current: true };
const dataRef: {
  current:
  | {
    stays: Admission[];
    patients: Patient[];
    therapists?: Therapist[];
    appointments?: Appointment[];
    visits: Visit[];
  }
  | null
  | undefined;
} = { current: undefined };

vi.mock('@/app/clinicContext', () => ({ useClinic: () => clinicRef.current }));
vi.mock('@/app/usePermissions', () => ({ usePermissions: () => ({ canBill: true }) }));
vi.mock('@/app/useEntitlements', () => ({ useEntitlements: () => ({ can: () => planAllows.current }) }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => dataRef.current }));
vi.mock('@/services', () => ({ repos: {} }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    className,
  }: {
    to: string;
    params?: object;
    search?: object;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a
      href={to}
      data-params={JSON.stringify(params ?? {})}
      data-search={JSON.stringify(search ?? {})}
      className={className}
    >
      {children}
    </a>
  ),
}));
vi.mock('@/features/patients/AddPatientSheet', () => ({ AddPatientSheet: () => null }));
vi.mock('@/features/patients/AdmissionSheet', () => ({ AdmissionSheet: () => null }));
vi.mock('./AdmitPatientPicker', () => ({ AdmitPatientPicker: () => null }));
vi.mock('@/components/IssueInvoiceDialog', () => ({ IssueInvoiceDialog: () => null }));

import { InpatientsCard } from './InpatientsCard';

const today = toLocalDateStr(new Date());
const stay = (id: string, patientId: string, over: Partial<Admission> = {}): Admission => ({
  id,
  clinicId: 'c',
  patientId,
  ipdNo: null,
  wardBed: null,
  admittingDoctor: null,
  admittedOn: today,
  dischargedOn: null,
  notes: null,
  deleted: false,
  updatedAt: '',
  ...over,
});
const patient = (id: string, name: string) =>
  ({ id, clinicId: 'c', name, mrno: id } as unknown as Patient);
const therapist = (id: string, name: string) =>
  ({ id, clinicId: 'c', name } as unknown as Therapist);
const visit = (id: string, admissionId: string, visitDate: string, over: Partial<Visit> = {}) =>
({
  id,
  admissionId,
  visitDate,
  deleted: false,
  actualBillPaise: 100000,
  invoiceId: null,
  therapistId: 't1',
  ...over,
} as unknown as Visit);
const appointment = (id: string, patientId: string, scheduledAt: string, over: Partial<Appointment> = {}) =>
({
  id,
  patientId,
  scheduledAt,
  location: 'ward',
  status: 'confirmed',
  therapistId: 't1',
  ...over,
} as unknown as Appointment);

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

  it('groups by ward, renders bed and day pills, timing badge, and links Log session', () => {
    dataRef.current = {
      stays: [
        stay('s1', 'p1', { wardBed: 'Ortho ward, bed 2', admittedOn: today }),
        stay('s2', 'p2', { wardBed: 'ICU, bed 1', ipdNo: '77' }),
      ],
      patients: [patient('p1', 'Asha'), patient('p2', 'Ravi')],
      therapists: [therapist('t1', 'Prem Anand')],
      appointments: [],
      visits: [visit('v1', 's1', today, { therapistId: 't1' }), visit('v0', 's1', '2020-01-01')],
    };
    render(<InpatientsCard />);
    const ortho = screen.getByRole('region', { name: 'Ortho ward' });
    expect(within(ortho).getByText('Asha')).toBeInTheDocument();
    expect(within(ortho).getByText('bed 2')).toBeInTheDocument();
    expect(within(ortho).getByText(/Day 1/)).toBeInTheDocument();
    expect(within(ortho).getByText(/Seen today · Prem/)).toBeInTheDocument();
    const log = within(ortho).getByRole('link', { name: '+ Log another' });
    expect(JSON.parse(log.getAttribute('data-search')!)).toMatchObject({
      patientId: 'p1',
      admissionId: 's1',
      from: '/workspace',
      repeatVisitId: 'v1',
    });

    const icu = screen.getByRole('region', { name: 'ICU' });
    expect(within(icu).queryByText(/Seen today/)).toBeNull();
    expect(within(icu).getByText('Pending round')).toBeInTheDocument();
    const first = within(icu).getByRole('link', { name: '+ Log session' });
    expect(JSON.parse(first.getAttribute('data-search')!)).toEqual({
      patientId: 'p2',
      admissionId: 's2',
      from: '/workspace',
    });
    expect(screen.getByRole('button', { name: '+ Admit patient' })).toBeInTheDocument();
  });

  it('renders Next round badge when an upcoming ward appointment exists today', () => {
    dataRef.current = {
      stays: [stay('s2', 'p2', { wardBed: 'ICU, bed 1' })],
      patients: [patient('p2', 'Ravi')],
      therapists: [therapist('t1', 'Prem')],
      appointments: [appointment('apt1', 'p2', `${today}T08:30:00Z`)],
      visits: [],
    };
    render(<InpatientsCard />);
    expect(screen.getByText(/Next round/)).toBeInTheDocument();
  });

  it('filters by ward chip when multiple wards exist', () => {
    dataRef.current = {
      stays: [
        stay('s1', 'p1', { wardBed: 'Ortho, Bed 1' }),
        stay('s2', 'p2', { wardBed: 'ICU, Bed 2' }),
      ],
      patients: [patient('p1', 'Asha'), patient('p2', 'Ravi')],
      therapists: [],
      appointments: [],
      visits: [],
    };
    render(<InpatientsCard />);
    expect(screen.getByRole('button', { name: /^All/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Ortho/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ICU/ })).toBeInTheDocument();

    // Click ICU chip
    fireEvent.click(screen.getByRole('button', { name: /^ICU/ }));
    expect(screen.queryByText('Asha')).toBeNull();
    expect(screen.getByText('Ravi')).toBeInTheDocument();
  });

  it('shows Bill stay button when clinic bills stay and unbilled sessions exist, hides when partner bills', () => {
    clinicRef.current = { id: 'c', careLocations: ['clinic', 'ward'], ipBilledByPartner: false };
    dataRef.current = {
      stays: [stay('s1', 'p1', { wardBed: 'Ortho, Bed 1' })],
      patients: [patient('p1', 'Asha')],
      therapists: [],
      appointments: [],
      visits: [visit('v1', 's1', today, { actualBillPaise: 100000, invoiceId: null })],
    };
    const { rerender } = render(<InpatientsCard />);
    expect(screen.getByRole('button', { name: 'Bill stay' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit stay' })).toBeInTheDocument();

    // When hospital partner bills inpatients, Bill stay is hidden
    clinicRef.current = { id: 'c', careLocations: ['clinic', 'ward'], ipBilledByPartner: true };
    rerender(<InpatientsCard />);
    expect(screen.queryByRole('button', { name: 'Bill stay' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit stay' })).toBeInTheDocument();
  });

  it('a plan without inpatient keeps showing who is already admitted but offers no Admit button', () => {
    planAllows.current = false;
    dataRef.current = {
      stays: [stay('s1', 'p1')],
      patients: [patient('p1', 'Asha')],
      therapists: [],
      appointments: [],
      visits: [],
    };
    render(<InpatientsCard />);
    expect(screen.getByText('Asha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Admit patient' })).toBeNull();
  });
});
