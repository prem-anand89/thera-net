import { describe, expect, it } from 'vitest';
import { formatAppointmentWhen } from './appointmentWhen';

describe('formatAppointmentWhen', () => {
  it('writes the day and time in the clinic zone, not the browser zone', () => {
    // 2026-11-03T10:00Z is 15:30 in Kolkata and 05:00 in New York.
    expect(formatAppointmentWhen('2026-11-03T10:00:00Z', 'Asia/Kolkata')).toBe('Tue, 3 Nov at 3:30 PM');
    expect(formatAppointmentWhen('2026-11-03T10:00:00Z', 'America/New_York')).toBe('Tue, 3 Nov at 5:00 AM');
  });
});
