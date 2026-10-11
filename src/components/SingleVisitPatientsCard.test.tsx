// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <a href="#ledger" className={className}>{children}</a>
  ),
}));

import { SingleVisitPatientsCard } from './SingleVisitPatientsCard';
import type { SingleVisitPatientRow } from '@/services/dashboardService';
import type { NoReturnReasonItem } from '@/domain/types';

afterEach(cleanup);

const mockPatients: SingleVisitPatientRow[] = [
  {
    patientId: 'p1',
    patientName: 'Aarav Patel',
    mrno: 'MR-001',
    serviceName: 'Initial Assessment',
    visitDate: '2026-08-10',
    daysSince: 62,
    phone: '9876543210',
    primaryCondition: 'Lower Back Pain',
    noReturnReasonId: null,
    noReturnReasonName: null,
    noReturnReasonClosed: false,
  },
  {
    patientId: 'p2',
    patientName: 'Priya Sharma',
    mrno: 'MR-002',
    serviceName: 'Sports Rehab',
    visitDate: '2026-09-01',
    daysSince: 40,
    phone: '9876543211',
    primaryCondition: 'ACL Recovery',
    noReturnReasonId: 'r1',
    noReturnReasonName: 'Financial constraint',
    noReturnReasonClosed: false,
  },
  {
    patientId: 'p3',
    patientName: 'Rohan Gupta',
    mrno: 'MR-003',
    serviceName: 'Neck Therapy',
    visitDate: '2026-09-20',
    daysSince: 21,
    phone: null,
    primaryCondition: 'Cervical Spondylosis',
    noReturnReasonId: 'r2',
    noReturnReasonName: 'Fully Recovered',
    noReturnReasonClosed: true,
  },
];

const mockReasons: NoReturnReasonItem[] = [
  {
    id: 'r1',
    clinicId: 'c1',
    name: 'Financial constraint',
    isClosed: false,
    active: true,
    updatedAt: '2026-09-01T00:00:00Z',
  },
  {
    id: 'r2',
    clinicId: 'c1',
    name: 'Fully Recovered',
    isClosed: true,
    active: true,
    updatedAt: '2026-09-01T00:00:00Z',
  },
];

describe('SingleVisitPatientsCard', () => {
  it('renders triage filter pills with accurate counts', () => {
    render(
      <SingleVisitPatientsCard
        patients={mockPatients}
        noReturnReasons={mockReasons}
        onSetPatientReason={vi.fn()}
        onToggleReasonActive={vi.fn()}
        onAddReason={vi.fn()}
        clinicId="c1"
        clinicName="Physio Plus"
      />
    );

    expect(screen.getByRole('button', { name: /All \(3\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Needs review \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reason logged \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Closed \/ Resolved \(1\)/i })).toBeInTheDocument();
  });

  it('filters rows when a triage pill is clicked', () => {
    render(
      <SingleVisitPatientsCard
        patients={mockPatients}
        noReturnReasons={mockReasons}
        onSetPatientReason={vi.fn()}
        onToggleReasonActive={vi.fn()}
        onAddReason={vi.fn()}
        clinicId="c1"
        clinicName="Physio Plus"
      />
    );

    // Initial state: all 3 patients shown
    expect(screen.getAllByText('Aarav Patel').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Priya Sharma').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rohan Gupta').length).toBeGreaterThan(0);

    // Click Needs Review
    fireEvent.click(screen.getByRole('button', { name: /Needs review \(1\)/i }));
    expect(screen.getAllByText('Aarav Patel').length).toBeGreaterThan(0);
    expect(screen.queryByText('Priya Sharma')).not.toBeInTheDocument();
    expect(screen.queryByText('Rohan Gupta')).not.toBeInTheDocument();

    // Click Closed / Resolved
    fireEvent.click(screen.getByRole('button', { name: /Closed \/ Resolved \(1\)/i }));
    expect(screen.queryByText('Aarav Patel')).not.toBeInTheDocument();
    expect(screen.getAllByText('Rohan Gupta').length).toBeGreaterThan(0);
  });

  it('filters rows via search box', () => {
    render(
      <SingleVisitPatientsCard
        patients={mockPatients}
        noReturnReasons={mockReasons}
        onSetPatientReason={vi.fn()}
        onToggleReasonActive={vi.fn()}
        onAddReason={vi.fn()}
        clinicId="c1"
        clinicName="Physio Plus"
      />
    );

    const searchInput = screen.getByPlaceholderText(/Search patient, MRNO, condition…/i);
    fireEvent.change(searchInput, { target: { value: 'ACL' } });

    expect(screen.queryByText('Aarav Patel')).not.toBeInTheDocument();
    expect(screen.getAllByText('Priya Sharma').length).toBeGreaterThan(0);
  });

  it('displays service name and calls onSetPatientReason on dropdown change', () => {
    const onSetPatientReason = vi.fn();
    render(
      <SingleVisitPatientsCard
        patients={mockPatients}
        noReturnReasons={mockReasons}
        onSetPatientReason={onSetPatientReason}
        onToggleReasonActive={vi.fn()}
        onAddReason={vi.fn()}
        clinicId="c1"
        clinicName="Physio Plus"
      />
    );

    // Initial assessment service is displayed
    expect(screen.getAllByText(/Initial Assessment/i).length).toBeGreaterThan(0);

    // Find the select dropdown for Aarav (the first one)
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'r1' } });

    expect(onSetPatientReason).toHaveBeenCalledWith('p1', 'r1');
  });

  it('toggles manage reasons panel and allows adding a reason', async () => {
    const onAddReason = vi.fn().mockResolvedValue(undefined);
    render(
      <SingleVisitPatientsCard
        patients={mockPatients}
        noReturnReasons={mockReasons}
        onSetPatientReason={vi.fn()}
        onToggleReasonActive={vi.fn()}
        onAddReason={onAddReason}
        clinicId="c1"
        clinicName="Physio Plus"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Manage reasons/i }));
    expect(screen.getByText(/Non-return reasons catalog/i)).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/New reason name/i);
    fireEvent.change(input, { target: { value: 'Moved away' } });

    const checkbox = screen.getByLabelText(/Counts as closed/i);
    fireEvent.click(checkbox);

    const addButton = screen.getByRole('button', { name: /\+ Add reason/i });
    fireEvent.click(addButton);

    expect(onAddReason).toHaveBeenCalledWith('Moved away', true);
  });
});
