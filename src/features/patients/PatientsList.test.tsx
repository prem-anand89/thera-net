// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PatientsList } from './PatientsPage';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
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

  it('uses FY and Month dropdowns directly on the toolbar without duplicating period tabs or a Filters drawer', () => {
    render(<PatientsList />);
    expect(screen.queryByRole('group', { name: 'Patient period' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Filters/ })).not.toBeInTheDocument();

    const fySelect = screen.getByRole('combobox', { name: 'Fiscal year' });
    const monthSelect = screen.getByRole('combobox', { name: 'Period within fiscal year' });
    expect(fySelect).toBeInTheDocument();
    expect(monthSelect).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search patients' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ Add/i })).toBeInTheDocument();

    // Selecting "All time" hides the month selector cleanly
    fireEvent.change(fySelect, { target: { value: 'all' } });
    expect(screen.queryByRole('combobox', { name: 'Period within fiscal year' })).not.toBeInTheDocument();

    // Selecting "Custom range…" reveals From / To date pickers
    fireEvent.change(fySelect, { target: { value: 'custom' } });
    expect(screen.getByLabelText('From date')).toBeInTheDocument();
    expect(screen.getByLabelText('To date')).toBeInTheDocument();
  });
});
