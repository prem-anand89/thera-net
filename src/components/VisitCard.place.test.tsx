// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1', name: 'Clinic' }) }));
vi.mock('@/app/usePermissions', () => ({ usePermissions: () => ({ isAdmin: false, canViewClinicalNotes: false }) }));

import { SharedVisitCard } from './VisitCard';
import type { VisitCardData } from './visit/types';

afterEach(cleanup);

const data = (over: Partial<VisitCardData>) =>
  ({
    visitId: 'v1',
    patientId: 'p1',
    patientName: 'Test Patient',
    mrno: 'P-1',
    visitDate: '2026-11-07',
    condition: null,
    serviceName: 'Exercise Therapy',
    sessionIndex: null,
    packageTotal: null,
    therapistName: 'Asha',
    treatmentNotes: null,
    treatmentNames: [],
    billPaise: 100000,
    collectedPaise: 0,
    paymentState: 'uninvoiced',
    canViewNotes: false,
    canAskForFeedback: false,
    needsNote: false,
    ...over,
  }) as unknown as VisitCardData;

function renderCard(d: VisitCardData) {
  render(<SharedVisitCard data={d} showDate showPatient={false} onInvoice={() => {}} onDelete={() => {}} />);
}

describe('SharedVisitCard place', () => {
  it('shows the place for a visit away from the clinic', () => {
    renderCard(data({ placeLabel: 'Home visit' }));
    expect(screen.getByText('Home visit')).toBeInTheDocument();
  });
  it('shows nothing for a clinic visit', () => {
    renderCard(data({ placeLabel: null }));
    expect(screen.queryByText('Home visit')).not.toBeInTheDocument();
    expect(screen.queryByText('Place')).not.toBeInTheDocument();
  });
  it('shows Inpatient for a ward visit', () => {
    renderCard(data({ placeLabel: 'Inpatient' }));
    expect(screen.getByText('Inpatient')).toBeInTheDocument();
  });
});

describe('SharedVisitCard bill link', () => {
  it('shows the bill number as a link only when the row carries one', () => {
    renderCard(data({ invoiceId: 'i1', invoiceNo: 'BM/26-27/0004' } as Partial<VisitCardData>));
    expect(screen.getByText('BM/26-27/0004')).toBeInTheDocument();
    cleanup();
    renderCard(data({ invoiceId: 'i1', invoiceNo: null } as Partial<VisitCardData>));
    expect(screen.queryByText('BM/26-27/0004')).not.toBeInTheDocument();
  });
});
