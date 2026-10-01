// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
