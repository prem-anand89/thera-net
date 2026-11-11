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

// Runs the query when the mocked repos answer at once; anything else (async, or a repo this test does not mock) is [].
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (q: () => unknown) => {
    try {
      const r = q();
      return r instanceof Promise ? [] : r;
    } catch {
      return [];
    }
  },
}));

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => ({
    id: 'c1',
    name: 'Test Clinic',
    fyStartMonth: 4,
  }),
}));

const scopeMock = vi.hoisted(() => ({ clinicWide: false }));
vi.mock('@/app/useWorkspaceScope', () => ({
  useWorkspaceScope: () => ({
    myTherapistId: 't1',
    isFrontDesk: false,
    isClinicWideView: scopeMock.clinicWide,
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
    therapists: { list: () => [{ id: 't1', name: 'Asha', active: true }, { id: 't2', name: 'Ravi', active: true }] },
    appointments: { listByClinic: () => [] },
    invoicePayments: { list: () => [] },
    payments: { list: () => [] },
  },
  patientService: {},
  feedbackService: {},
}));

afterEach(cleanup);

describe('Seen by filter', () => {
  it('is offered to admin and front desk, and choosing a therapist drops My patients', async () => {
    scopeMock.clinicWide = true;
    render(<PatientsList />);
    const select = await screen.findByRole('combobox', { name: 'Seen by' });
    fireEvent.click(screen.getByRole('button', { name: 'My patients' }));
    expect(screen.getByRole('button', { name: 'My patients' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(select, { target: { value: 't2' } });
    expect(screen.getByRole('button', { name: 'My patients' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    scopeMock.clinicWide = false;
  });

  it('is not shown to a therapist', async () => {
    scopeMock.clinicWide = false;
    render(<PatientsList />);
    await screen.findByRole('button', { name: 'All' });
    expect(screen.queryByRole('combobox', { name: 'Seen by' })).toBeNull();
  });
});

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
