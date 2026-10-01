// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Appointment, AppointmentRequest } from '@/domain/types';
import { localDateTime } from '@/domain/schedule';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <a href="#complete" className={className}>{children}</a>
  ),
}));

import { TodayAppointments } from './TodayAppointments';

let n = 0;
const appt = (time: string, over: Partial<Appointment> = {}): Appointment => ({
  id: `a${n++}`, clinicId: 'c', patientId: null, patientName: `P${n}`, patientPhone: '1', therapistId: 't1',
  scheduledAt: localDateTime('2026-10-01', time).toISOString(), durationMinutes: 30, status: 'confirmed',
  requestId: null, visitId: null, rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '', ...over,
});

function setup(appointments: Appointment[]) {
  const onSelect = vi.fn();
  render(
    <TodayAppointments
      appointments={appointments}
      slotMinutes={30}
      nextUpId={null}
      colorFor={() => '#000'}
      therapistNameFor={() => 'Dr A'}
      showTherapist
      onSelect={onSelect}
    />
  );
  return { onSelect };
}

describe('TodayAppointments', () => {
  afterEach(cleanup);

  it('shows visits in progress first with Complete visit, then 5 upcoming with Show all', () => {
    const upcoming = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00'].map((t) => appt(t));
    setup([appt('09:00', { status: 'arrived', source: 'walk_in', patientName: 'Walk In' }), ...upcoming]);
    const progress = screen.getByRole('region', { name: 'In progress' });
    expect(within(progress).getByText('Walk In')).toBeInTheDocument();
    expect(within(progress).getAllByText(/Walk-in/).length).toBeGreaterThan(0);
    expect(within(progress).getByText('Complete visit')).toBeInTheDocument();
    expect(within(progress).getByRole('link', { name: /Complete/ })).toBeInTheDocument();

    const upcomingList = screen.getByRole('region', { name: 'Upcoming' });
    expect(within(upcomingList).getAllByRole('button').filter((b) => b.textContent?.includes('P'))).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 7 upcoming' }));
    expect(within(upcomingList).getAllByRole('button').filter((b) => b.textContent?.includes('P'))).toHaveLength(7);
  });

  it('folds finished appointments under Done', () => {
    setup([
      appt('09:00', { status: 'arrived', visitId: 'v1', patientName: 'Seen' }),
      appt('09:30', { status: 'no_show', patientName: 'Missed' }),
      appt('11:00', { patientName: 'Later' }),
    ]);
    expect(screen.getByText('Done (2)')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'In progress' })).not.toBeInTheDocument();
  });

  it('handles an empty day', () => {
    setup([]);
    expect(screen.getByText('No appointments today.')).toBeInTheDocument();
  });

  it('lists booking requests first, with Confirm / Decline and See all past three', () => {
    const request = (i: number): AppointmentRequest => ({
      id: `r${i}`, clinicId: 'c', name: `Req ${i}`, phone: '98', email: null, preferredTherapistId: 't1', notes: null,
      preferredDate: null, preferredTimeText: 'evening', status: 'pending', appointmentId: null,
      createdAt: new Date(Date.now() - i * 3_600_000).toISOString(), updatedAt: '',
    });
    const onConfirm = vi.fn();
    const onDecline = vi.fn();
    const onSeeAll = vi.fn();
    render(
      <TodayAppointments
        appointments={[]}
        slotMinutes={30}
          nextUpId={null}
        colorFor={() => '#000'}
        therapistNameFor={() => 'Dr A'}
        showTherapist
        onSelect={vi.fn()}
        requests={[1, 2, 3, 4].map(request)}
        therapistNameForId={() => 'Dr A'}
        onConfirmRequest={onConfirm}
        onDeclineRequest={onDecline}
        onSeeAllRequests={onSeeAll}
      />
    );
    const section = screen.getByRole('region', { name: 'Requests to confirm' });
    expect(within(section).getByText('Requests to confirm (4)')).toBeInTheDocument();
    expect(within(section).getAllByRole('button', { name: 'Confirm' })).toHaveLength(3);
    fireEvent.click(within(section).getAllByRole('button', { name: 'Confirm' })[0]);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    fireEvent.click(within(section).getAllByRole('button', { name: 'Decline' })[1]);
    expect(onDecline).toHaveBeenCalledWith(expect.objectContaining({ id: 'r2' }));
    fireEvent.click(within(section).getByRole('button', { name: 'See all 4 requests' }));
    expect(onSeeAll).toHaveBeenCalled();
    expect(screen.getByText('No appointments today.')).toBeInTheDocument();
  });
});
