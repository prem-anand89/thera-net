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

function show(
  appointment: Appointment,
  canManage = true,
  extra: { condition?: string | null; requestNotes?: string | null } = {}
) {
  render(
    <AppointmentDetailsPanel
      appointment={appointment}
      therapistName="Bm"
      therapistColor="#a6552f"
      therapistPhone={null}
      slotMinutes={30}
      canManage={canManage}
      condition={extra.condition}
      requestNotes={extra.requestNotes}
      onClose={() => {}}
      onReschedule={() => {}}
      onStartNote={() => {}}
    />
  );
}

describe('AppointmentDetailsPanel', () => {
  afterEach(cleanup);

  it('colleague appointment (canManage = false): hides patient phone, call, WhatsApp/remind, notes, and management actions', () => {
    show(
      appt({
        patientId: 'p1',
        patientPhone: '9032323890',
      }),
      false,
      {
        condition: 'Lumbar strain',
        requestNotes: 'Lower back stiffness for 2 weeks',
      }
    );

    // Patient name is rendered as plain text, not a link to patient file
    expect(screen.getByText('Prem')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Prem' })).not.toBeInTheDocument();

    // Sensitive info hidden
    expect(screen.queryByText('9032323890')).not.toBeInTheDocument();
    expect(screen.queryByText('Condition')).not.toBeInTheDocument();
    expect(screen.queryByText('Lumbar strain')).not.toBeInTheDocument();
    expect(screen.queryByText('Patient says')).not.toBeInTheDocument();
    expect(screen.queryByText('Lower back stiffness for 2 weeks')).not.toBeInTheDocument();

    // Communication actions hidden
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    expect(screen.queryByText('Remind')).not.toBeInTheDocument();

    // Management actions hidden
    expect(screen.queryByRole('button', { name: /Mark arrived/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
    expect(screen.queryByText('Create visit')).not.toBeInTheDocument();
    expect(screen.queryByText('Reschedule')).not.toBeInTheDocument();
    expect(screen.queryByText('No-show')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel appointment')).not.toBeInTheDocument();
  });

  it('own appointment (canManage = true): displays phone, call, remind, notes, and management actions as expected', () => {
    show(
      appt({
        patientId: 'p1',
        patientPhone: '9032323890',
      }),
      true,
      {
        condition: 'Lumbar strain',
        requestNotes: 'Lower back stiffness for 2 weeks',
      }
    );

    // Patient name is rendered as a link to patient file
    expect(screen.getByRole('link', { name: 'Prem' })).toBeInTheDocument();

    // Sensitive info shown
    expect(screen.getByText('9032323890')).toBeInTheDocument();
    expect(screen.getByText('Condition')).toBeInTheDocument();
    expect(screen.getByText('Lumbar strain')).toBeInTheDocument();
    expect(screen.getByText('Patient says')).toBeInTheDocument();
    expect(screen.getByText('Lower back stiffness for 2 weeks')).toBeInTheDocument();

    // Communication actions shown
    expect(screen.getByText('Call')).toBeInTheDocument();
    expect(screen.getByText('Remind')).toBeInTheDocument();

    // Management actions shown
    expect(screen.getByRole('button', { name: /Mark arrived/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(screen.getByText('Create visit')).toBeInTheDocument();
    expect(screen.getByText('Reschedule')).toBeInTheDocument();
    expect(screen.getByText('No-show')).toBeInTheDocument();
    expect(screen.getByText('Cancel appointment')).toBeInTheDocument();
  });

  it('when canManage is true but appointment has no patient phone or therapist phone: Reschedule and No-show still show', () => {
    show(
      appt({
        patientPhone: '',
      }),
      true
    );

    // Communication actions hidden because no phone
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    expect(screen.queryByText('Remind')).not.toBeInTheDocument();
    expect(screen.queryByText('Message therapist')).not.toBeInTheDocument();

    // Management quick actions MUST still show (no regression for managers/own appointments)
    expect(screen.getByText('Reschedule')).toBeInTheDocument();
    expect(screen.getByText('No-show')).toBeInTheDocument();
  });

  it('before arrival: Mark arrived is the main action; Add note and Create visit sit beside it; length in minutes', () => {
    show(appt());
    expect(screen.getByRole('button', { name: /Mark arrived/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
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
    fireEvent.click(screen.getByText('Cancel this and later sessions…'));
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
    show(appt({ status: 'cancelled', scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore appointment' }));
    expect(restoreCancelledAppointment).toHaveBeenCalledWith('a1');
  });

  it('shows neither to someone who cannot manage the appointment, or once a visit exists', () => {
    show(appt({ status: 'no_show' }), false);
    expect(screen.queryByRole('button', { name: 'Undo no-show' })).not.toBeInTheDocument();
    cleanup();
    show(appt({ status: 'cancelled', visitId: 'v1', scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }));
    expect(screen.queryByRole('button', { name: 'Restore appointment' })).not.toBeInTheDocument();
    cleanup();
    show(appt({ status: 'cancelled' })); // its time has passed: the server would refuse
    expect(screen.queryByRole('button', { name: 'Restore appointment' })).not.toBeInTheDocument();
  });
});
