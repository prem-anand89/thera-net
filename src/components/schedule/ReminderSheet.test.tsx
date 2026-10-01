// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
import { localDateTime } from '@/domain/schedule';

const sendText = vi.fn();
vi.mock('@/services', () => ({ bookingService: { sendText: (...args: unknown[]) => sendText(...args) } }));

import { ReminderSheet } from './ReminderSheet';

const appt = (over: Partial<Appointment>): Appointment => ({
  id: 'a1', clinicId: 'c', patientId: null, patientName: 'Priya Nair', patientPhone: '9820000001', therapistId: 't1',
  scheduledAt: localDateTime('2026-10-02', '10:00').toISOString(), durationMinutes: 30, status: 'confirmed',
  requestId: null, visitId: null, rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '', ...over,
});

const therapists = [
  { id: 't1', name: 'Dr Asha', phone: '9820000100' },
  { id: 't2', name: 'Dr Ravi', phone: null },
];

describe('ReminderSheet', () => {
  afterEach(() => {
    cleanup();
    sendText.mockClear();
  });

  function setup() {
    render(
      <ReminderSheet
        open
        initialDate="2026-10-02"
        clinicName="BM Physio"
        slotMinutes={30}
        therapists={therapists}
        onClose={() => {}}
        appointments={[
          appt({}),
          appt({ id: 'a2', patientName: 'Rohit Verma', patientPhone: '', therapistId: 't2', scheduledAt: localDateTime('2026-10-02', '11:00').toISOString() }),
          appt({ id: 'a3', patientName: 'Cancelled Person', status: 'cancelled' }),
          appt({ id: 'a4', patientName: 'Other Day', scheduledAt: localDateTime('2026-10-03', '10:00').toISOString() }),
        ]}
      />
    );
  }

  it('lists only that day’s live appointments and sends a reminder per patient', () => {
    setup();
    const list = screen.getAllByRole('listitem');
    expect(list).toHaveLength(2);
    expect(screen.queryByText('Cancelled Person')).not.toBeInTheDocument();
    const priya = list.find((row) => within(row).queryByText('Priya Nair'))!;
    fireEvent.click(within(priya).getByRole('button', { name: 'Send' }));
    expect(sendText).toHaveBeenCalledWith(expect.stringContaining('a reminder of your appointment at BM Physio with Dr Asha'), '9820000001');
    expect(within(priya).getByRole('button', { name: 'Sent ✓' })).toBeInTheDocument();
    const rohit = list.find((row) => within(row).queryByText('Rohit Verma'))!;
    expect(within(rohit).getByRole('button', { name: 'Send' })).toBeDisabled(); // no phone
  });

  it('sends each therapist their day list; disabled without a phone', () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: /Therapists/ }));
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Send list' }));
    expect(sendText).toHaveBeenCalledWith(expect.stringMatching(/^Hi Dr Asha, your 1 appointment on Friday, 2 Oct:\n• 10:00 am — Priya N\. \(30 min\)$/i), '9820000100');
    expect(within(rows[1]).getByRole('button', { name: 'Send list' })).toBeDisabled();
  });

  it('keeps its state when the parent re-renders with a new onClose', () => {
    const props = {
      open: true,
      initialDate: '2026-10-02',
      clinicName: 'BM Physio',
      slotMinutes: 30,
      therapists,
      appointments: [appt({})],
    };
    const { rerender } = render(<ReminderSheet {...props} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('button', { name: 'Sent ✓' })).toBeInTheDocument();
    // Schedule re-renders every minute and on each sync, passing a fresh arrow.
    rerender(<ReminderSheet {...props} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Sent ✓' })).toBeInTheDocument();
  });
});
