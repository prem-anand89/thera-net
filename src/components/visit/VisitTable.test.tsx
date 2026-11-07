// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1', name: 'Clinic' }) }));
vi.mock('@/app/usePermissions', () => ({ usePermissions: () => ({ isAdmin: false, canViewClinicalNotes: false }) }));

import { VisitTable } from './VisitTable';
import type { VisitCardData } from './types';

afterEach(cleanup);

const row = (over: Partial<VisitCardData>) =>
  ({
    visitId: 'v1',
    patientId: 'p1',
    patientName: 'Test Patient',
    visitDate: '2026-11-07',
    billPaise: 100000,
    collectedPaise: 0,
    paymentState: 'uninvoiced',
    serviceNames: ['Exercise Therapy'],
    treatmentNames: [],
    canViewNotes: false,
    canAskForFeedback: false,
    needsNote: false,
    ...over,
  }) as unknown as VisitCardData;

const columnPrefs = { therapist: true, condition: true, treatments: true, service: true } as never;

function renderTable(rows: VisitCardData[]) {
  render(
    <VisitTable
      rows={rows}
      showDate
      showPatient
      columnPrefs={columnPrefs}
      onColumnPrefsChange={() => {}}
      onInvoice={() => {}}
      onDelete={() => {}}
      onAskForFeedback={() => {}}
      canInvoice
    />
  );
}

describe('VisitTable Actions column', () => {
  it('is left out when nobody on screen can use the note or feedback links', () => {
    renderTable([row({})]);
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('shows for front desk once feedback may be asked, with the Feedback button', () => {
    renderTable([row({ canAskForFeedback: true })]);
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Feedback' })).toBeInTheDocument();
  });

  it('shows when notes can be viewed', () => {
    renderTable([row({ canViewNotes: true })]);
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
  });
});

describe('VisitTable place', () => {
  it('names the place under the service when the row carries one, and says nothing otherwise', () => {
    renderTable([row({ serviceName: 'Exercise Therapy', placeLabel: 'Home visit' })]);
    expect(screen.getByText('Home visit')).toBeInTheDocument();
    cleanup();
    renderTable([row({ serviceName: 'Exercise Therapy', placeLabel: null })]);
    expect(screen.queryByText('Home visit')).not.toBeInTheDocument();
  });
});

describe('VisitTable bill link', () => {
  it('shows the bill number when the row carries one, and not otherwise', () => {
    renderTable([row({ invoiceId: 'i1', invoiceNo: 'BM/26-27/0004', paymentState: 'paid' } as Partial<VisitCardData>)]);
    expect(screen.getByText('BM/26-27/0004')).toBeInTheDocument();
    cleanup();
    renderTable([row({ invoiceId: 'i1', invoiceNo: null, paymentState: 'paid' } as Partial<VisitCardData>)]);
    expect(screen.queryByText('BM/26-27/0004')).not.toBeInTheDocument();
  });
});
