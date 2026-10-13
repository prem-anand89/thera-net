import { addDays, workingIntervals } from './schedule';
import type { WorkingHours } from './types';

export const CLINIC_TIMEZONE = 'Asia/Kolkata';

/**
 * Returns the current date and minutes-since-midnight in clinic time (Asia/Kolkata).
 * Ensures booking decisions remain pinned to the clinic's clock even when opened
 * by traveling patients across time zones.
 */
export function clinicNow(date: Date = new Date()): { dateIso: string; minutes: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const dateIso = `${get('year')}-${get('month')}-${get('day')}`;
  const hours = parseInt(get('hour'), 10) % 24;
  const minutes = parseInt(get('minute'), 10);
  return { dateIso, minutes: hours * 60 + minutes };
}

export type PublicDayStatus =
  | 'past'
  | 'closed'
  | 'holiday'
  | 'far'
  | 'therapistOff'
  | 'available';

export interface GetDayStatusOptions {
  dateIso: string;
  todayIso: string;
  nowMinutes?: number;
  closedWeekdays: number[];
  closedDates: { date: string; label?: string }[];
  bookableTherapists: { id: string; name?: string }[];
  preferredTherapistId?: string | null;
  therapistHours?: Record<string, WorkingHours> | null;
  clinicHours: { startHour: number; endHour: number };
  slotDurationMinutes?: number;
  bookingWindowDays?: number;
}

/**
 * Classifies a calendar date for the public booking page.
 * Pure function: avoids flaky mocks and handles all edge cases cleanly.
 */
export function getDayStatus(options: GetDayStatusOptions): PublicDayStatus {
  const {
    dateIso,
    todayIso,
    nowMinutes,
    closedWeekdays,
    closedDates,
    bookableTherapists,
    preferredTherapistId,
    therapistHours,
    clinicHours,
    slotDurationMinutes = 30,
    bookingWindowDays = 90,
  } = options;

  if (dateIso < todayIso) return 'past';
  if (dateIso > addDays(todayIso, bookingWindowDays)) return 'far';

  const dayOfWeek = new Date(`${dateIso}T00:00:00`).getDay();
  if (closedWeekdays.includes(dayOfWeek)) return 'closed';
  if (closedDates.some((cd) => cd.date === dateIso)) return 'holiday';

  // Clinician availability: if preferred or all bookable therapists are off,
  // the day is off regardless of whether it is today or a future date.
  if (preferredTherapistId) {
    const hours = therapistHours?.[preferredTherapistId];
    if (hours && workingIntervals(hours, dateIso, clinicHours).length === 0) {
      return 'therapistOff';
    }
  } else if (bookableTherapists.length > 0) {
    // Under "First available", off only if ALL bookable therapists are off
    const allOff = bookableTherapists.every((t) => {
      const hours = therapistHours?.[t.id] ?? null;
      // A therapist without custom hours uses clinic hours, which are open
      if (!hours) return false;
      return workingIntervals(hours, dateIso, clinicHours).length === 0;
    });
    if (allOff) return 'therapistOff';
  }

  // Today is over: if today, check if any bookable slot starts after nowMinutes
  if (dateIso === todayIso && nowMinutes !== undefined) {
    const isTherapistRelevant = (therapistId: string) =>
      !preferredTherapistId || preferredTherapistId === therapistId;

    const relevantTherapists = bookableTherapists.filter((t) => isTherapistRelevant(t.id));

    let maxLatestSlot = 0;
    const candidates = relevantTherapists.length > 0 ? relevantTherapists : [{ id: '' }];
    for (const t of candidates) {
      const hours = t.id ? therapistHours?.[t.id] : null;
      const intervals = hours
        ? workingIntervals(hours, dateIso, clinicHours)
        : [{ start: clinicHours.startHour * 60, end: clinicHours.endHour * 60 }];
      for (const interval of intervals) {
        if (interval.end > maxLatestSlot) maxLatestSlot = interval.end;
      }
    }

    if (maxLatestSlot === 0 || nowMinutes >= maxLatestSlot - slotDurationMinutes) {
      return 'past';
    }
  }

  return 'available';
}

export type NormalizedPhoneResult =
  | { valid: true; normalized: string; stored: string }
  | { valid: false; error: string };

/**
 * Validates and normalizes phone number input based on selected country code.
 * Ensures leading 0 is stripped and standardized "+<code> <digits>" formatting is returned for storage.
 */
export function normalizeAndValidatePhone(countryCode: string, phone: string): NormalizedPhoneResult {
  const trimmed = phone.trim();
  if (!trimmed) return { valid: false, error: 'Phone number is required.' };

  if (countryCode === '+91') {
    let digits = trimmed.replace(/[\s\-()]/g, '');
    // If patient pasted with +91 or 91 prefix
    if (digits.startsWith('+91')) digits = digits.slice(3);
    else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
    // Strip leading zero
    if (digits.startsWith('0')) digits = digits.slice(1);

    if (!/^\d{10}$/.test(digits)) {
      return { valid: false, error: 'Enter a valid 10-digit mobile number.' };
    }
    return { valid: true, normalized: digits, stored: `+91 ${digits}` };
  }

  if (!countryCode) {
    if (!trimmed.startsWith('+')) {
      return { valid: false, error: 'Include country code with + (e.g. +971...).' };
    }
    const digits = trimmed.slice(1).replace(/[\s\-()]/g, '');
    if (!/^\d{8,15}$/.test(digits)) {
      return { valid: false, error: 'Enter a valid phone number with country code (e.g. +971...).' };
    }
    return { valid: true, normalized: `+${digits}`, stored: `+${digits}` };
  }

  let digits = trimmed.replace(/[\s\-()]/g, '');
  if (digits.startsWith(countryCode)) digits = digits.slice(countryCode.length);
  const bareCode = countryCode.replace(/\D/g, '');
  if (bareCode && digits.startsWith(bareCode) && digits.length - bareCode.length >= 7) {
    digits = digits.slice(bareCode.length);
  }
  if (digits.startsWith('0') && digits.length > 6) digits = digits.slice(1);

  if (!/^\d{6,15}$/.test(digits)) {
    return { valid: false, error: 'Enter a valid phone number (6–15 digits).' };
  }
  return { valid: true, normalized: digits, stored: `${countryCode} ${digits}` };
}

/**
 * Validates patient phone input based on selected country code.
 */
export function validatePhone(countryCode: string, phone: string): string | null {
  const res = normalizeAndValidatePhone(countryCode, phone);
  return res.valid ? null : res.error;
}

/**
 * Validates email if provided (since email is optional).
 */
export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return 'Enter a valid email address (e.g. name@example.com).';
  }
  return null;
}
