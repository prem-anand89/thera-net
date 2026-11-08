// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Appointment, Patient } from '@/domain/types';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, search, children, className }: { to: string; search?: Record<string, unknown>; children: React.ReactNode; className?: string }) => (
    <a href={to} data-search={JSON.stringify(search ?? {})} className={className}>
      {children}
    </a>
  ),
}));

import { HomeVisitsCard } from './HomeVisitsCard';

const makeAppointment = (id: string, name: string, time: string, status: Appointment['status'] = 'confirmed', visitId: string | null = null): Appointment => ({
  id,
  clinicId: 'c1',
  patientId: `p-${id}`,
  patientName: name,
  patientPhone: '9876543210',
  scheduledAt: `2026-11-09T${time}:00Z`,
  durationMinutes: 45,
  status,
  location: 'home',
  visitId,
  source: 'booking',
  therapistId: 'th-1',
  requestId: null,
  rescheduleCount: 0,
  previousScheduledAt: null,
  createdAt: '2026-11-08T10:00:00Z',
  updatedAt: '2026-11-08T10:00:00Z',
});

const makePatient = (id: string, name: string, address: string): Patient => ({
  id,
  clinicId: 'c1',
  name,
  phone: '9876543210',
  address,
  deleted: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
} as unknown as Patient);

describe('HomeVisitsCard', () => {
  afterEach(cleanup);

  it('shows empty state when there are no appointments today', () => {
    render(<HomeVisitsCard appointments={[]} />);
    expect(screen.getByText('No home visits scheduled today')).toBeInTheDocument();
    expect(screen.getByText('None today')).toBeInTheDocument();
  });

  it('renders home appointments in time order with address, Copy address, Call and Arrived button', () => {
    const apt1 = makeAppointment('a1', 'Kavita Roy', '11:00');
    const apt2 = makeAppointment('a2', 'Arun Kumar', '09:00');
    const p1 = makePatient('p-a1', 'Kavita Roy', '12 Lake Rd, Sector 4');
    const p2 = makePatient('p-a2', 'Arun Kumar', '45 Green Park, Flat 2B');

    const patientsMap = new Map([
      ['p-a1', p1],
      ['p-a2', p2],
    ]);

    const onMarkArrived = vi.fn();

    render(
      <HomeVisitsCard
        appointments={[apt1, apt2]}
        patientsById={patientsMap}
        onMarkArrived={onMarkArrived}
      />
    );

    expect(screen.getByText('2 left')).toBeInTheDocument();

    const names = screen.getAllByRole('heading', { level: 4 }).map((el) => el.textContent);
    expect(names[0]).toContain('Arun Kumar');
    expect(names[1]).toContain('Kavita Roy');

    expect(screen.getByText('45 Green Park, Flat 2B')).toBeInTheDocument();
    expect(screen.getByText('12 Lake Rd, Sector 4')).toBeInTheDocument();

    const copyButtons = screen.getAllByRole('button', { name: 'Copy address' });
    expect(copyButtons).toHaveLength(2);

    const callLinks = screen.getAllByRole('link', { name: 'Call' });
    expect(callLinks).toHaveLength(2);
    expect(callLinks[0]).toHaveAttribute('href', 'tel:9876543210');

    const arrivedButtons = screen.getAllByRole('button', { name: /arrived/i });
    expect(arrivedButtons).toHaveLength(2);

    fireEvent.click(arrivedButtons[0]);
    expect(onMarkArrived).toHaveBeenCalledWith(apt2);
  });

  it('renders Log visit link and Undo button when appointment is arrived', () => {
    const arrivedApt = makeAppointment('a1', 'Kavita Roy', '10:00', 'arrived');
    const p1 = makePatient('p-a1', 'Kavita Roy', '12 Lake Rd');
    const patientsMap = new Map([['p-a1', p1]]);
    const onUndoArrived = vi.fn();

    render(
      <HomeVisitsCard
        appointments={[arrivedApt]}
        patientsById={patientsMap}
        onUndoArrived={onUndoArrived}
      />
    );

    const logVisitLink = screen.getByRole('link', { name: 'Log visit' });
    expect(logVisitLink).toBeInTheDocument();
    expect(logVisitLink).toHaveAttribute('href', '/visits/new');
    expect(logVisitLink.getAttribute('data-search')).toContain('"appointmentId":"a1"');

    const undoBtn = screen.getByRole('button', { name: /undo/i });
    expect(undoBtn).toBeInTheDocument();
    fireEvent.click(undoBtn);
    expect(onUndoArrived).toHaveBeenCalledWith(arrivedApt);
  });
});
