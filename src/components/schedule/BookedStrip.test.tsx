// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BookedSlot } from '@/components/BookSlotSheet';

const { messagePatient, messageTherapist } = vi.hoisted(() => ({ messagePatient: vi.fn(), messageTherapist: vi.fn() }));
vi.mock('@/services', () => ({ bookingService: { messagePatient, messageTherapist } }));

import { BookedStrip } from './BookedStrip';

const booked: BookedSlot = {
  kind: 'booked',
  appointmentId: 'a1',
  scheduledAt: '2026-10-31T12:00:00',
  durationMinutes: 30,
  patientName: 'Kavin P',
  patientPhone: '9820000002',
  therapistId: 't1',
};

describe('BookedStrip', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('offers a one-tap WhatsApp to the patient with the real number, clinic and therapist', () => {
    render(<BookedStrip booked={booked} clinicName="Beyond Mechanics" therapist={{ name: 'Prem Anand' }} onDismiss={vi.fn()} />);
    expect(screen.getByText('Kavin P')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Message patient' }));
    expect(messagePatient).toHaveBeenCalledWith('booked', {
      patientName: 'Kavin P',
      patientPhone: '9820000002',
      clinicName: 'Beyond Mechanics',
      scheduledAt: '2026-10-31T12:00:00',
      therapistName: 'Prem Anand',
      sessions: undefined,
    });
    expect(screen.queryByRole('button', { name: 'Message therapist' })).toBeNull();
  });

  it('offers the therapist message only when their number is on file, and dismisses', () => {
    const onDismiss = vi.fn();
    render(<BookedStrip booked={booked} clinicName="BM" therapist={{ name: 'Prem Anand', phone: '9811111111' }} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Message therapist' }));
    expect(messageTherapist).toHaveBeenCalledWith('booked', expect.objectContaining({ therapistPhone: '9811111111' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('has no patient button when the booking has no phone', () => {
    render(<BookedStrip booked={{ ...booked, patientPhone: '' }} clinicName="BM" onDismiss={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Message patient' })).toBeNull();
  });
});
