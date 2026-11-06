// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
import { localDateTime } from '@/domain/schedule';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';

const clinicRef: { current: { id: string; name: string; careLocations?: string[] } } = { current: { id: 'c', name: 'BM Physio' } };
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => <a href="#link" className={className}>{children}</a>,
}));
vi.mock('dexie-react-hooks', async () => {
  const React = await import('react');
  return {
    useLiveQuery: (fn: () => Promise<unknown>, deps: unknown[]) => {
      const [value, setValue] = React.useState<unknown>(undefined);
      React.useEffect(() => {
        let live = true;
        void fn().then((v) => live && setValue(v));
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
      return value;
    },
  };
});
const getPatient = vi.hoisted(() => vi.fn());
vi.mock('@/services', () => ({
  bookingService: { cancelAppointment: vi.fn() },
  repos: { patients: { get: (id: string) => getPatient(id) } },
}));

import { AppointmentDetailsPanel } from './AppointmentDetailsPanel';

const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1', clinicId: 'c', patientId: 'p1', patientName: 'Sunitha', patientPhone: '9032323890', therapistId: 't1',
  scheduledAt: localDateTime('2026-10-01', '11:00').toISOString(), durationMinutes: 60, status: 'confirmed',
  requestId: null, visitId: null, rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '', ...over,
});

function show(appointment: Appointment) {
  render(
    <ClinicContext.Provider value={clinicRef.current as unknown as Clinic}>
      <AppointmentDetailsPanel
        appointment={appointment} therapistName="Kiran" therapistColor="#a6552f" therapistPhone={null} slotMinutes={30}
        canManage onClose={() => {}} onReschedule={() => {}} onStartNote={() => {}}
      />
    </ClinicContext.Provider>
  );
}

afterEach(() => {
  cleanup();
  clinicRef.current = { id: 'c', name: 'BM Physio' };
  getPatient.mockReset();
});

describe('Home appointment in the panel', () => {
  it('a clinic that only sees patients in one place shows no home mark, even for a home record', () => {
    show(appt({ location: 'home' }));
    expect(screen.queryByText('Home visit')).toBeNull();
    expect(screen.queryByText('Copy address')).toBeNull();
    expect(getPatient).not.toHaveBeenCalled();
  });

  it('shows the Home badge, the patient\'s address and a Copy address button', async () => {
    clinicRef.current = { id: 'c', name: 'BM Physio', careLocations: ['clinic', 'home'] };
    getPatient.mockResolvedValue({ id: 'p1', address: 'Flat 4B, Lotus Residency' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    show(appt({ location: 'home' }));
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(await screen.findByText('Flat 4B, Lotus Residency')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    expect(writeText).toHaveBeenCalledWith('Flat 4B, Lotus Residency');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Address copied ✓' })).toBeInTheDocument());
  });

  it('says so when the patient has no address, and a clinic appointment shows nothing extra', async () => {
    clinicRef.current = { id: 'c', name: 'BM Physio', careLocations: ['clinic', 'home'] };
    getPatient.mockResolvedValue({ id: 'p1', address: null });
    show(appt({ location: 'home' }));
    expect(await screen.findByText(/No address on file/)).toBeInTheDocument();
    cleanup();
    show(appt({ location: 'clinic' }));
    expect(screen.queryByText('Home visit')).toBeNull();
  });
});
