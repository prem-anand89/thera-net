// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Appointment, AppointmentRequest } from '@/domain/types';
import { localDateTime } from '@/domain/schedule';
import { formatDateDM } from '@/domain/fiscalYear';

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

  it('folds finished appointments under Done today', () => {
    setup([
      appt('09:00', { status: 'arrived', visitId: 'v1', patientName: 'Seen' }),
      appt('09:30', { status: 'no_show', patientName: 'Missed' }),
      appt('11:00', { patientName: 'Later' }),
    ]);
    expect(screen.getByText(/Done today \(2\)/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'In progress' })).not.toBeInTheDocument();
  });

  it('renders rescheduled status and next badge in upcoming list', () => {
    const a1 = appt('10:30', { id: 'next-1', status: 'rescheduled', patientName: 'Ananya' });
    render(
      <TodayAppointments
        appointments={[a1]}
        slotMinutes={30}
        nextUpId="next-1"
        colorFor={() => '#000'}
        therapistNameFor={() => 'Prem Anand'}
        showTherapist
        onSelect={vi.fn()}
      />
    );
    const upcomingList = screen.getByRole('region', { name: 'Upcoming' });
    expect(within(upcomingList).getByText('Ananya')).toBeInTheDocument();
    expect(within(upcomingList).getByText('Next')).toBeInTheDocument();
    expect(within(upcomingList).getAllByText(/Rescheduled/).length).toBeGreaterThan(0);
  });

  it('handles an empty day', () => {
    setup([]);
    expect(screen.getByText(/No appointments today/)).toBeInTheDocument();
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
    expect(screen.getByText(/No appointments today/)).toBeInTheDocument();
  });
});

describe('TodayAppointments quick actions', () => {
  afterEach(cleanup);

  it('upcoming rows get a one-tap Arrived button', () => {
    const onMarkArrived = vi.fn();
    const a = appt('10:00', { patientName: 'Ananya' });
    render(
      <TodayAppointments
        appointments={[a]}
        slotMinutes={30}
        nextUpId={null}
        colorFor={() => '#000'}
        therapistNameFor={() => 'Dr A'}
        showTherapist
        onSelect={vi.fn()}
        onMarkArrived={onMarkArrived}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Mark .* arrived/ }));
    expect(onMarkArrived).toHaveBeenCalledWith(a);
  });

  it('finished rows show Due or Paid marker, and the Done summary counts them', () => {
    const onUndoNoShow = vi.fn();
    const owes = appt('09:00', { status: 'arrived', visitId: 'v-due', patientName: 'Owes' });
    const paid = appt('09:30', { status: 'arrived', visitId: 'v-paid', patientName: 'Paid up' });
    const missed = appt('10:00', { status: 'no_show', patientName: 'Missed' });
    render(
      <TodayAppointments
        appointments={[owes, paid, missed]}
        slotMinutes={30}
        nextUpId={null}
        colorFor={() => '#000'}
        therapistNameFor={() => 'Dr A'}
        showTherapist
        onSelect={vi.fn()}
        dueByVisitId={new Map([['v-due', true], ['v-paid', false]])}
        onUndoNoShow={onUndoNoShow}
      />
    );
    expect(screen.getByText(/Done today \(3\)/)).toBeInTheDocument();
    expect(screen.getByText(/2 logged · 1 no-show · 1 due/)).toBeInTheDocument();
    // Open fold
    const details = screen.getByText(/Done today \(3\)/).closest('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(screen.getByText('Due')).toBeInTheDocument();
    expect(screen.getByText('Paid ✓')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Undo no-show for Missed/ }));
    expect(onUndoNoShow).toHaveBeenCalledWith(missed);
  });
});

describe('TodayAppointments carried-over and Done defaults', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('Done is closed by default, and an open choice is remembered', () => {
    localStorage.clear();
    render(
      <TodayAppointments
        appointments={[appt('09:00', { status: 'arrived', visitId: 'v1', patientName: 'Seen' })]}
        slotMinutes={30}
        nextUpId={null}
        colorFor={() => '#000'}
        therapistNameFor={() => 'Dr A'}
        showTherapist
        onSelect={vi.fn()}
      />
    );
    const details = screen.getByText(/Done today \(1\)/).closest('details')!;
    expect(details.open).toBe(false);
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(localStorage.getItem('theranet:today-done-open')).toBe('open');
  });

  it('shows the date under the time for an appointment from another day', () => {
    const old = appt('09:00', { status: 'arrived', visitId: 'v1', patientName: 'Yesterday', scheduledAt: localDateTime('2026-09-01', '09:00').toISOString() });
    render(
      <TodayAppointments
        appointments={[old]}
        slotMinutes={30}
        nextUpId={null}
        colorFor={() => '#000'}
        therapistNameFor={() => 'Dr A'}
        showTherapist
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText(formatDateDM(old.scheduledAt))).toBeInTheDocument();
  });
});

describe('TodayAppointments end of day and cancelled', () => {
  afterEach(cleanup);
  const baseProps = {
    slotMinutes: 30,
    nextUpId: null,
    colorFor: () => '#000',
    therapistNameFor: () => 'Dr A',
    showTherapist: true,
    onSelect: vi.fn(),
  };

  it('says all done (not "no more appointments") when everything is finished', () => {
    render(<TodayAppointments {...baseProps} appointments={[appt('09:00', { status: 'arrived', visitId: 'v1' })]} />);
    expect(screen.getByText(/All done for today/)).toBeInTheDocument();
    expect(screen.queryByText('No more appointments today.')).not.toBeInTheDocument();
  });

  it('lists cancelled appointments in their own fold and offers Restore only while the time is ahead', () => {
    const onRestoreCancelled = vi.fn();
    const future = appt('09:00', { status: 'cancelled', patientName: 'Later', scheduledAt: new Date(Date.now() + 3_600_000).toISOString() });
    const past = appt('08:00', { status: 'cancelled', patientName: 'Earlier', scheduledAt: new Date(Date.now() - 3_600_000).toISOString() });
    render(<TodayAppointments {...baseProps} appointments={[past, future]} onRestoreCancelled={onRestoreCancelled} />);
    expect(screen.getByText('Cancelled (2)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restore Earlier/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Restore Later/ }));
    expect(onRestoreCancelled).toHaveBeenCalledWith(future);
  });

  it('ignores a second tap on Arrived while the first request is still running', async () => {
    let release: () => void = () => {};
    const onMarkArrived = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const a = appt('10:00', { patientName: 'Slow' });
    render(
      <TodayAppointments
        appointments={[a]}
        slotMinutes={30}
        nextUpId={null}
        colorFor={() => '#000'}
        therapistNameFor={() => 'Dr A'}
        showTherapist
        onSelect={vi.fn()}
        onMarkArrived={onMarkArrived}
      />
    );
    const button = screen.getByRole('button', { name: /Mark Slow arrived/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onMarkArrived).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    release();
  });
});
