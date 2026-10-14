// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
import { localDateTime } from '@/domain/schedule';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <a href="#link" className={className}>{children}</a>
  ),
}));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c', name: 'BM Physio' }) }));
vi.mock('@/services', () => ({ bookingService: {} }));

import { AppointmentDetailsPanel } from './AppointmentDetailsPanel';

const at = (time: string) => localDateTime('2026-10-01', time).toISOString();
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1', clinicId: 'c', patientId: null, patientName: 'Prem', patientPhone: '9032323890', therapistId: 't1',
  scheduledAt: at('10:00'), durationMinutes: 60, status: 'confirmed',
  requestId: null, visitId: null, rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '', ...over,
});

function show(appointment: Appointment, canManage = true) {
  render(
    <AppointmentDetailsPanel
      appointment={appointment}
      therapistName="Bm"
      therapistColor="#a6552f"
      therapistPhone={null}
      slotMinutes={30}
      canManage={canManage}
      onClose={() => {}}
      onReschedule={() => {}}
      onStartNote={() => {}}
    />
  );
}

describe('AppointmentDetailsPanel', () => {
  afterEach(cleanup);

  it('before arrival: Mark arrived is the main action; Start note and Create visit sit beside it; length in minutes', () => {
    show(appt());
    expect(screen.getByRole('button', { name: /Mark arrived/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start note' })).toBeInTheDocument();
    expect(screen.getByText('Create visit')).toBeInTheDocument();
    expect(screen.getByText('· 60m')).toBeInTheDocument();
    for (const name of ['Call', 'Remind', 'Reschedule', 'No-show', 'Cancel appointment']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('after arrival: Complete visit replaces Mark arrived', () => {
    show(appt({ status: 'arrived' }));
    expect(screen.queryByRole('button', { name: /Mark arrived/ })).not.toBeInTheDocument();
    expect(screen.getByText('Complete visit')).toBeInTheDocument();
  });

  it('shows "Moved from" only when the time actually moved', () => {
    show(appt({ status: 'rescheduled', previousScheduledAt: at('10:00') }));
    expect(screen.queryByText('Moved from')).not.toBeInTheDocument();
    cleanup();
    show(appt({ status: 'rescheduled', previousScheduledAt: at('09:00') }));
    expect(screen.getByText('Moved from')).toBeInTheDocument();
  });

  it('without manage rights: no Reschedule, No-show or Cancel', () => {
    show(appt(), false);
    for (const name of ['Reschedule', 'No-show', 'Cancel appointment']) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
  });
});

describe('AppointmentDetailsPanel confirmations', () => {
  afterEach(cleanup);

  it('asks before marking a no-show', async () => {
    const markAppointmentNoShow = vi.fn(async () => {});
    const bs = (await import('@/services')).bookingService as unknown as Record<string, unknown>;
    bs.markAppointmentNoShow = markAppointmentNoShow;
    show(appt());
    fireEvent.click(screen.getByText('No-show'));
    expect(markAppointmentNoShow).not.toHaveBeenCalled();
    expect(screen.getByText('Mark as no-show?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark no-show' }));
    expect(markAppointmentNoShow).toHaveBeenCalledWith('a1');
  });

  it('cancelling a series asks again, naming how many sessions go', () => {
    const onCancelSeries = vi.fn();
    render(
      <AppointmentDetailsPanel
        appointment={appt({ seriesId: 's1' } as Partial<Appointment>)}
        therapistName="Bm"
        therapistColor="#a6552f"
        therapistPhone={null}
        slotMinutes={30}
        canManage
        onClose={() => {}}
        onReschedule={() => {}}
        onCancelSeries={onCancelSeries}
        seriesFollowingCount={5}
      />
    );
    fireEvent.click(screen.getByText('Cancel appointment'));
    fireEvent.click(screen.getByText('Cancel this and all following sessions…'));
    expect(onCancelSeries).not.toHaveBeenCalled();
    expect(screen.getByText('Cancel 5 sessions?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel 5 sessions' }));
    expect(onCancelSeries).toHaveBeenCalledTimes(1);
  });
});

describe('AppointmentDetailsPanel restore actions', () => {
  afterEach(cleanup);

  it('a no-show offers Undo no-show and Reschedule, and Undo calls the restore RPC', async () => {
    const restoreNoShowAppointment = vi.fn(async () => {});
    const bs = (await import('@/services')).bookingService as unknown as Record<string, unknown>;
    bs.restoreNoShowAppointment = restoreNoShowAppointment;
    show(appt({ status: 'no_show' }));
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo no-show' }));
    expect(restoreNoShowAppointment).toHaveBeenCalledWith('a1');
  });

  it('a cancelled appointment offers Restore, which calls the restore RPC', async () => {
    const restoreCancelledAppointment = vi.fn(async () => {});
    const bs = (await import('@/services')).bookingService as unknown as Record<string, unknown>;
    bs.restoreCancelledAppointment = restoreCancelledAppointment;
    show(appt({ status: 'cancelled' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore appointment' }));
    expect(restoreCancelledAppointment).toHaveBeenCalledWith('a1');
  });

  it('shows neither to someone who cannot manage the appointment, or once a visit exists', () => {
    show(appt({ status: 'no_show' }), false);
    expect(screen.queryByRole('button', { name: 'Undo no-show' })).not.toBeInTheDocument();
    cleanup();
    show(appt({ status: 'cancelled', visitId: 'v1' }));
    expect(screen.queryByRole('button', { name: 'Restore appointment' })).not.toBeInTheDocument();
  });
});
