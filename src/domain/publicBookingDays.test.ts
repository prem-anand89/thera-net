import { describe, expect, it } from 'vitest';
import {
  clinicNow,
  getDayStatus,
  normalizeAndValidatePhone,
  validateEmail,
  validatePhone,
} from './publicBookingDays';
import { normalizePhoneForWaMe } from '@/lib/pdfShare';
import type { WorkingHours } from './types';

describe('publicBookingDays', () => {
  describe('clinicNow', () => {
    it('formats date and minutes in Asia/Kolkata timezone regardless of host timezone', () => {
      // 2026-10-13T14:30:00Z is 20:00 (8:00 PM) in Asia/Kolkata (+05:30)
      const date = new Date('2026-10-13T14:30:00Z');
      const now = clinicNow(date);
      expect(now.dateIso).toBe('2026-10-13');
      expect(now.minutes).toBe(20 * 60); // 1200
    });

    it('correctly handles midnight rollover in Asia/Kolkata', () => {
      // 2026-10-13T19:00:00Z is 2026-10-14T00:30:00 in Asia/Kolkata
      const date = new Date('2026-10-13T19:00:00Z');
      const now = clinicNow(date);
      expect(now.dateIso).toBe('2026-10-14');
      expect(now.minutes).toBe(30);
    });
  });

  describe('getDayStatus (Bug 1 & Bug 2)', () => {
    const clinicHours = { startHour: 9, endHour: 17 }; // 9 AM to 5 PM
    const bookableTherapists = [
      { id: 't1', name: 'Dr. Custom' },
      { id: 't2', name: 'Dr. Default' },
    ];

    // Saturday 2026-10-17
    const saturday = '2026-10-17';
    // Working hours for t1: Mon-Fri 9-17, Sat off (empty intervals)
    const t1Hours: WorkingHours = {
      '1': [[540, 1020]],
      '2': [[540, 1020]],
      '3': [[540, 1020]],
      '4': [[540, 1020]],
      '5': [[540, 1020]],
      '6': [], // Saturday off
    };

    it('Bug 1: marks Saturday available under "First available" when a clinic-default therapist is working', () => {
      // t1 is off on Saturday, t2 has null/undefined hours (clinic default, so works open clinic days)
      const therapistHours = {
        t1: t1Hours,
      };

      const status = getDayStatus({
        dateIso: saturday,
        todayIso: '2026-10-13',
        closedWeekdays: [0], // Only Sunday closed
        closedDates: [],
        bookableTherapists,
        preferredTherapistId: null,
        therapistHours,
        clinicHours,
      });

      expect(status).toBe('available');
    });

    it('marks Saturday as therapistOff if the preferred therapist is off', () => {
      const therapistHours = {
        t1: t1Hours,
      };

      const status = getDayStatus({
        dateIso: saturday,
        todayIso: '2026-10-13',
        closedWeekdays: [0],
        closedDates: [],
        bookableTherapists,
        preferredTherapistId: 't1',
        therapistHours,
        clinicHours,
      });

      expect(status).toBe('therapistOff');
    });

    it('marks Saturday as therapistOff when ALL bookable therapists are off', () => {
      // Both t1 and t2 have Saturday off
      const therapistHours = {
        t1: t1Hours,
        t2: t1Hours,
      };

      const status = getDayStatus({
        dateIso: saturday,
        todayIso: '2026-10-13',
        closedWeekdays: [0],
        closedDates: [],
        bookableTherapists,
        preferredTherapistId: null,
        therapistHours,
        clinicHours,
      });

      expect(status).toBe('therapistOff');
    });

    it('ignores non-bookable therapists with hours', () => {
      // Non-bookable therapist t3 is off on Saturday, but only t2 (clinic default) is bookable
      const therapistHours = {
        t3: t1Hours,
      };

      const status = getDayStatus({
        dateIso: saturday,
        todayIso: '2026-10-13',
        closedWeekdays: [0],
        closedDates: [],
        bookableTherapists: [{ id: 't2', name: 'Dr. Default' }],
        preferredTherapistId: null,
        therapistHours,
        clinicHours,
      });

      expect(status).toBe('available');
    });

    it('Bug 2: marks today as past when nowMinutes is after the last bookable slot', () => {
      // Clinic closes at 17:00 (1020 min). At 20:00 (1200 min), today is over.
      const status = getDayStatus({
        dateIso: '2026-10-13',
        todayIso: '2026-10-13',
        nowMinutes: 20 * 60, // 8:00 PM
        closedWeekdays: [],
        closedDates: [],
        bookableTherapists,
        preferredTherapistId: null,
        clinicHours,
        slotDurationMinutes: 30,
      });

      expect(status).toBe('past');
    });

    it('Bug 2: keeps today as available during business hours even if slots remain', () => {
      // At 10:00 AM (600 min), clinic is open until 17:00.
      const status = getDayStatus({
        dateIso: '2026-10-13',
        todayIso: '2026-10-13',
        nowMinutes: 10 * 60, // 10:00 AM
        closedWeekdays: [],
        closedDates: [],
        bookableTherapists,
        preferredTherapistId: null,
        clinicHours,
        slotDurationMinutes: 30,
      });

      expect(status).toBe('available');
    });

    it('marks clinic closed weekdays as closed', () => {
      // Sunday 2026-10-18
      const status = getDayStatus({
        dateIso: '2026-10-18',
        todayIso: '2026-10-13',
        closedWeekdays: [0], // Sunday
        closedDates: [],
        bookableTherapists,
        clinicHours,
      });

      expect(status).toBe('closed');
    });

    it('marks clinic closed dates as holiday', () => {
      const status = getDayStatus({
        dateIso: '2026-10-20',
        todayIso: '2026-10-13',
        closedWeekdays: [],
        closedDates: [{ date: '2026-10-20', label: 'Diwali' }],
        bookableTherapists,
        clinicHours,
      });

      expect(status).toBe('holiday');
    });

    it('marks dates beyond the 90-day window as far', () => {
      const status = getDayStatus({
        dateIso: '2027-02-01',
        todayIso: '2026-10-13',
        closedWeekdays: [],
        closedDates: [],
        bookableTherapists,
        clinicHours,
        bookingWindowDays: 90,
      });

      expect(status).toBe('far');
    });

    it('returns therapistOff (not past) if therapist is off today during operating hours', () => {
      // Tuesday 2026-10-13, t1 works Mon-Fri except Tuesday is off
      const tuesdayOffHours: WorkingHours = {
        '2': [], // Tuesday off
      };
      const status = getDayStatus({
        dateIso: '2026-10-13',
        todayIso: '2026-10-13',
        nowMinutes: 10 * 60, // 10:00 AM
        closedWeekdays: [],
        closedDates: [],
        bookableTherapists: [{ id: 't1', name: 'Dr. Custom' }],
        preferredTherapistId: 't1',
        therapistHours: { t1: tuesdayOffHours },
        clinicHours,
      });

      expect(status).toBe('therapistOff');
    });

    it('returns closed (not past) if today is a clinic closed day', () => {
      const status = getDayStatus({
        dateIso: '2026-10-13',
        todayIso: '2026-10-13',
        nowMinutes: 10 * 60,
        closedWeekdays: [2], // Tuesday closed
        closedDates: [],
        bookableTherapists,
        preferredTherapistId: null,
        clinicHours,
      });

      expect(status).toBe('closed');
    });
  });

  describe('normalizeAndValidatePhone', () => {
    it('normalizes +91 numbers by stripping leading 0, pasted +91, and formatting', () => {
      expect(validatePhone('+91', '9876543210')).toBeNull();
      expect(validatePhone('+91', '98765 43210')).toBeNull();
      expect(validatePhone('+91', '09876543210')).toBeNull();
      expect(validatePhone('+91', '+91 98765 43210')).toBeNull();
      expect(validatePhone('+91', '919876543210')).toBeNull();
      expect(validatePhone('+91', '98765-43210')).toBeNull();

      expect(validatePhone('+91', '')).toBe('Phone number is required.');
      expect(validatePhone('+91', '12345')).toBe('Enter a valid 10-digit mobile number.');
      expect(validatePhone('+91', '987654321000')).toBe('Enter a valid 10-digit mobile number.');
      expect(validatePhone('+91', 'abcdefghij')).toBe('Enter a valid 10-digit mobile number.');

      const res = normalizeAndValidatePhone('+91', '98765 43210');
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.stored).toBe('+91 9876543210');
        expect(normalizePhoneForWaMe(res.stored)).toBe('919876543210');
      }
    });

    it('handles non-+91 country codes: strips bare code only when remainder >= 7 digits', () => {
      // +971 + 971501234567 -> strips bare 971 -> +971 501234567
      const uaeRes = normalizeAndValidatePhone('+971', '971501234567');
      expect(uaeRes.valid).toBe(true);
      if (uaeRes.valid) {
        expect(uaeRes.stored).toBe('+971 501234567');
      }

      // +1 + 4155552671 -> does not start with 1, remains unchanged
      const usRes = normalizeAndValidatePhone('+1', '4155552671');
      expect(usRes.valid).toBe(true);
      if (usRes.valid) {
        expect(usRes.stored).toBe('+1 4155552671');
      }

      // +44 + 07911 123456 -> strips leading 0 -> +44 7911123456
      const ukRes = normalizeAndValidatePhone('+44', '07911 123456');
      expect(ukRes.valid).toBe(true);
      if (ukRes.valid) {
        expect(ukRes.stored).toBe('+44 7911123456');
      }
    });

    it('validates international phone numbers (6 to 15 digits)', () => {
      expect(validatePhone('+1', '415 555 2671')).toBeNull();
      expect(validatePhone('+44', '20 7946 0912')).toBeNull();
      expect(validatePhone('+1', '12345')).toBe('Enter a valid phone number (6–15 digits).');
    });

    it('validates "Other" country code (must start with + and 8-15 digits)', () => {
      expect(validatePhone('', '+971 50 123 4567')).toBeNull();
      expect(validatePhone('', '9876543210')).toBe('Include country code with + (e.g. +971...).');
      expect(validatePhone('', '+1234')).toBe('Enter a valid phone number with country code (e.g. +971...).');
    });
  });

  describe('validateEmail', () => {
    it('allows empty/whitespace email since it is optional', () => {
      expect(validateEmail('')).toBeNull();
      expect(validateEmail('   ')).toBeNull();
    });

    it('validates standard email formats', () => {
      expect(validateEmail('patient@example.com')).toBeNull();
      expect(validateEmail('patient.name+tag@sub.domain.co.in')).toBeNull();

      expect(validateEmail('not-an-email')).toBe('Enter a valid email address (e.g. name@example.com).');
      expect(validateEmail('missing@domain')).toBe('Enter a valid email address (e.g. name@example.com).');
      expect(validateEmail('spaces in@email.com')).toBe('Enter a valid email address (e.g. name@example.com).');
    });
  });
});

