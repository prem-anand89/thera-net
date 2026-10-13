// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PatientsList } from './PatientsPage';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a href="#test" className={className}>
      {children}
    </a>
  ),
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => [],
}));

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => ({
    id: 'c1',
    name: 'Test Clinic',
    fyStartMonth: 4,
    enablePatientComms: false,
  }),
}));

vi.mock('@/app/useWorkspaceScope', () => ({
  useWorkspaceScope: () => ({
    myTherapistId: 't1',
    isFrontDesk: false,
  }),
}));

vi.mock('@/app/usePermissions', () => ({
  usePermissions: () => ({
    canBill: true,
    isAdmin: true,
  }),
}));

vi.mock('@/services', () => ({
  repos: {
    referringSourceCatalog: { list: () => [] },
    visits: { list: () => [] },
    patients: { list: () => [] },
    therapists: { list: () => [] },
    appointments: { listByClinic: () => [] },
    invoicePayments: { list: () => [] },
    payments: { list: () => [] },
  },
  patientService: {},
  feedbackService: {},
}));

afterEach(cleanup);

describe('PatientsList chips', () => {
  it('renders only "All" and "My patients" chips, with "Needs invoice" removed', () => {
    render(<PatientsList />);
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My patients' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /needs invoice/i })).not.toBeInTheDocument();
  });
});
