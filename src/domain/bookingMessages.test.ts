import { describe, expect, it } from 'vitest';
import { patientMessage, shortPatientName, therapistDayListMessage, therapistMessage } from './bookingMessages';
import { localDateTime } from './schedule';

const at = (date: string, time: string) => localDateTime(date, time).toISOString();

describe('booking messages', () => {
  it('shortens patient names for therapist messages', () => {
    expect(shortPatientName('Priya Nair')).toBe('Priya N.');
    expect(shortPatientName('  Anil   Kumar Rao ')).toBe('Anil R.');
    expect(shortPatientName('Madonna')).toBe('Madonna');
  });

  it('words each patient message', () => {
    const input = { patientName: 'Priya', clinicName: 'BM Physio', scheduledAt: at('2026-10-02', '10:30'), therapistName: 'Dr Asha' };
    expect(patientMessage('booked', input)).toMatch(/^Hi Priya, your appointment at BM Physio with Dr Asha is confirmed for Fri, 2 Oct.*10:30/);
    expect(patientMessage('rescheduled', input)).toContain('has been moved to');
    expect(patientMessage('cancelled', input)).toContain('has been cancelled');
    expect(patientMessage('reminder', input)).toContain('a reminder of your appointment');
  });

  it('never puts the full patient name in therapist messages', () => {
    const text = therapistMessage('booked', { therapistName: 'Asha', patientName: 'Priya Nair', scheduledAt: at('2026-10-02', '10:30') });
    expect(text).toContain('Priya N.');
    expect(text).not.toContain('Nair');
  });

  it('lists a therapist’s day in time order', () => {
    const text = therapistDayListMessage({
      therapistName: 'Asha',
      date: '2026-10-02',
      appointments: [
        { scheduledAt: at('2026-10-02', '11:00'), patientName: 'Rohit Verma', durationMinutes: 30 },
        { scheduledAt: at('2026-10-02', '09:00'), patientName: 'Priya Nair', durationMinutes: 45 },
      ],
    });
    expect(text.split('\n')[0]).toBe('Hi Asha, your 2 appointments on Friday, 2 Oct:');
    expect(text.indexOf('Priya N.')).toBeLessThan(text.indexOf('Rohit V.'));
    expect(text).toContain('(45 min)');
    expect(therapistDayListMessage({ therapistName: 'Asha', date: '2026-10-02', appointments: [] })).toContain('no appointments');
  });
});
