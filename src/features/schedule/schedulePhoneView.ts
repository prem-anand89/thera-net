import { addDays } from '@/domain/schedule';

export type SchedulePhoneView = 'list' | 'day' | '3day';

export const SCHEDULE_PHONE_VIEW_KEY = 'theranet:schedule-phone-view';
export const DEFAULT_SCHEDULE_PHONE_VIEW: SchedulePhoneView = 'day';

export function readStoredPhoneView(): SchedulePhoneView {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(SCHEDULE_PHONE_VIEW_KEY) : null;
    if (raw === 'list' || raw === 'day' || raw === '3day') {
      return raw;
    }
  } catch {
    // ignore storage unavailable
  }
  return DEFAULT_SCHEDULE_PHONE_VIEW;
}

export function writeStoredPhoneView(view: SchedulePhoneView): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SCHEDULE_PHONE_VIEW_KEY, view);
    }
  } catch {
    // ignore storage unavailable
  }
}

/** Given a starting date, returns an array of 3 consecutive ISO date strings. */
export function getThreeDayDates(startDate: string): [string, string, string] {
  return [startDate, addDays(startDate, 1), addDays(startDate, 2)];
}

/**
 * Returns the amount of days to step given the current view.
 * Day view steps 1 day; 3-Day view steps 3 days; List view steps 1 day.
 */
export function getPhoneStepAmount(view: SchedulePhoneView, direction: 1 | -1): number {
  const days = view === '3day' ? 3 : 1;
  return direction * days;
}

/**
 * Checks whether the current phone view window includes the specified today string.
 */
export function isPhoneTodayVisible(view: SchedulePhoneView, currentDate: string, today: string): boolean {
  if (view === '3day') {
    return getThreeDayDates(currentDate).includes(today);
  }
  return currentDate === today;
}

/**
 * Formats a 3-day date range for display in the schedule toolbar.
 * Example: "18 – 20 Oct" or "30 Oct – 1 Nov"
 */
export function formatThreeDayRange(startDate: string): string {
  const [d1, , d3] = getThreeDayDates(startDate);
  const start = new Date(`${d1}T00:00:00`);
  const end = new Date(`${d3}T00:00:00`);

  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    const month = start.toLocaleDateString('en-IN', { month: 'short' });
    return `${start.getDate()} – ${end.getDate()} ${month}`;
  }
  const startStr = start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const endStr = end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${startStr} – ${endStr}`;
}

export const SCHEDULE_LONG_PRESS_HINT_KEY = 'theranet:schedule-long-press-hint';

export function readStoredLongPressHintDismissed(): boolean {
  try {
    return typeof window !== 'undefined' && localStorage.getItem(SCHEDULE_LONG_PRESS_HINT_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

export function writeStoredLongPressHintDismissed(): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SCHEDULE_LONG_PRESS_HINT_KEY, 'dismissed');
    }
  } catch {
    // ignore storage unavailable
  }
}

