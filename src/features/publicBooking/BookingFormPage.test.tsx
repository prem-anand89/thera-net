// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { addDays } from '@/domain/schedule';
import { clinicNow } from '@/domain/publicBookingDays';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ clinicSlug: 'test-clinic' }),
}));

vi.mock('@/lib/env', () => ({
  hasSupabaseConfig: true,
}));

vi.mock('@/lib/supabase', () => ({
  publicLogoUrl: () => null,
}));

let mockClinicNowTime = { dateIso: '2026-10-13', minutes: 10 * 60 };

vi.mock('@/domain/publicBookingDays', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/publicBookingDays')>();
  return {
    ...actual,
    clinicNow: () => mockClinicNowTime,
  };
});

const mockClinicInfo = {
  name: 'Sunrise Wellness',
  logoPath: null,
  slotDurationMinutes: 30,
  bookingStartHour: 9,
  bookingEndHour: 11, // 4 slots: 09:00, 09:30, 10:00, 10:30
};

const mockTherapists = [{ id: 't1', name: 'Dr. Asha' }];

let mockAvailability = {
  closedWeekdays: [] as number[],
  closedDates: [] as { date: string; label: string }[],
  appointments: [] as { scheduled_at: string; therapist_id: string; duration_minutes?: number }[],
  therapistHours: {} as Record<string, unknown>,
};

const submitAppointmentRequest = vi.fn(async () => ({ success: true }));

vi.mock('@/services', () => ({
  bookingService: {
    getBookingClinicInfo: vi.fn(async () => mockClinicInfo),
    listBookingTherapists: vi.fn(async () => mockTherapists),
    getBookingAvailability: vi.fn(async () => mockAvailability),
    submitAppointmentRequest: (...args: unknown[]) => submitAppointmentRequest(...(args as [])),
  },
}));

import { BookingFormPage } from './BookingFormPage';
import { bookingService } from '@/services';

describe('BookingFormPage', () => {
  beforeEach(() => {
    mockAvailability = {
      closedWeekdays: [],
      closedDates: [],
      appointments: [],
      therapistHours: {},
    };
    submitAppointmentRequest.mockClear();
    window.scrollTo = vi.fn();
    mockClinicNowTime = { dateIso: '2026-10-13', minutes: 10 * 60 };
  });

  afterEach(() => {
    cleanup();
  });

  it('shows "Join the waitlist" on a fully booked future day', async () => {
    const today = clinicNow().dateIso;
    const tomorrow = addDays(today, 1);

    // Populate all slots for tomorrow so day is fully booked
    mockAvailability.appointments = [
      { scheduled_at: `${tomorrow}T09:00:00`, therapist_id: 't1', duration_minutes: 30 },
      { scheduled_at: `${tomorrow}T09:30:00`, therapist_id: 't1', duration_minutes: 30 },
      { scheduled_at: `${tomorrow}T10:00:00`, therapist_id: 't1', duration_minutes: 30 },
      { scheduled_at: `${tomorrow}T10:30:00`, therapist_id: 't1', duration_minutes: 30 },
    ];

    render(<BookingFormPage />);

    // Wait for clinic name to be loaded
    expect(await screen.findByText('Sunrise Wellness')).toBeInTheDocument();

    // Look for tomorrow button in the strip and click it
    const dateButtons = screen.getAllByRole('button', { name: new RegExp(new Date(`${tomorrow}T00:00:00`).getDate().toString()) });
    const tomorrowBtn = dateButtons.find((btn) => btn.getAttribute('aria-label')?.includes(tomorrow.slice(8, 10)) || btn.textContent?.includes(new Date(`${tomorrow}T00:00:00`).getDate().toString()));
    expect(tomorrowBtn).toBeDefined();
    fireEvent.click(tomorrowBtn!);

    // Should indicate no times left and prompt for waitlist
    expect(await screen.findByText(/No times left/i)).toBeInTheDocument();
    expect(screen.getByText(/Fill in your details below to join the waitlist/i)).toBeInTheDocument();

    // The submit button should say "Join the waitlist"
    const submitBtn = screen.getByRole('button', { name: 'Join the waitlist' });
    expect(submitBtn).toBeInTheDocument();
  });

  it('warns instead of showing everything as open when live availability cannot be loaded, and can retry', async () => {
    vi.mocked(bookingService.getBookingAvailability).mockRejectedValueOnce(new Error('network'));
    render(<BookingFormPage />);
    expect(await screen.findByText('Sunrise Wellness')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't check live availability/);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('normalizes phone with leading 0 or pasted +91 upon submission', async () => {
    render(<BookingFormPage />);
    expect(await screen.findByText('Sunrise Wellness')).toBeInTheDocument();

    // Switch to flexible scheduling mode to avoid needing specific slot clicks
    fireEvent.click(screen.getByRole('button', { name: /Flexible/i }));

    // Fill in name and phone with leading 0
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: 'Priya Sharma' } });
    fireEvent.change(screen.getByLabelText(/Phone number/i), { target: { value: '098765 43210' } });

    fireEvent.click(screen.getByRole('button', { name: /Request appointment/i }));

    expect(submitAppointmentRequest).toHaveBeenCalledWith(
      'test-clinic',
      'Priya Sharma',
      '+91 9876543210', // Normalized!
      null,
      null,
      null,
      null,
      null,
      'any',
      false
    );

    expect(await screen.findByText('Appointment requested!')).toBeInTheDocument();
  });

  it('resets form completely when "Book another appointment" is clicked', async () => {
    render(<BookingFormPage />);
    expect(await screen.findByText('Sunrise Wellness')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Flexible/i }));
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: 'Anand Patel' } });
    fireEvent.change(screen.getByLabelText(/Phone number/i), { target: { value: '9876543210' } });

    fireEvent.click(screen.getByRole('button', { name: /Request appointment/i }));
    expect(await screen.findByText('Appointment requested!')).toBeInTheDocument();

    // Click "Book another appointment"
    fireEvent.click(screen.getByRole('button', { name: /Book another appointment/i }));

    // Form is back to initial state
    expect(await screen.findByLabelText(/Full name/i)).toHaveValue('');
    expect(screen.getByLabelText(/Phone number/i)).toHaveValue('');
  });

  it('disables today in the 14-day strip when visited after closing (8 PM)', async () => {
    mockClinicNowTime = { dateIso: '2026-10-13', minutes: 20 * 60 }; // 8:00 PM (clinic closes at 11:00 AM in mockClinicInfo)
    render(<BookingFormPage />);

    expect(await screen.findByText('Sunrise Wellness')).toBeInTheDocument();

    const todayBtn = screen.getByRole('button', { name: /hours ended for today/i });
    expect(todayBtn).toBeDisabled();
    expect(todayBtn).toHaveAttribute('aria-label', expect.stringContaining('hours ended for today'));
  });
});

