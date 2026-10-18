import { addDays, localDateTime } from '@/domain/schedule';

export type PhoneView = 'list' | 'day' | '3day';

export const PHONE_VIEW_STORAGE_KEY = 'theranet:schedule-phone-view';

/**
 * Reads the phone view preference from localStorage.
 * Falls back to 'day' if not set, invalid, or if localStorage throws.
 */
export function readStoredPhoneView(): PhoneView {
  try {
    const val = localStorage.getItem(PHONE_VIEW_STORAGE_KEY);
    if (val === 'list' || val === 'day' || val === '3day') {
      return val;
    }
  } catch {
    // Ignore localStorage errors (private browsing, disabled storage, jsdom)
  }
  return 'day';
}

/**
 * Persists the phone view preference to localStorage.
 * Safe against environments where storage is disabled or throws.
 */
export function writeStoredPhoneView(view: PhoneView): void {
  try {
    localStorage.setItem(PHONE_VIEW_STORAGE_KEY, view);
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Returns an array of 3 consecutive ISO date strings starting from the given date.
 */
export function threeDayDates(startDate: string): [string, string, string] {
  return [startDate, addDays(startDate, 1), addDays(startDate, 2)];
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Formats a 3-day date range for display in the schedule toolbar.
 * - Same month/year: "19 – 21 Oct 2026"
 * - Spanning month: "30 Oct – 1 Nov 2026"
 * - Spanning year: "31 Dec 2026 – 2 Jan 2027"
 */
export function formatThreeDayTitle(startDate: string): string {
  const dates = threeDayDates(startDate);
  const d0 = localDateTime(dates[0], '00:00');
  const d2 = localDateTime(dates[2], '00:00');

  const startDay = d0.getDate();
  const startMonth = MONTH_NAMES[d0.getMonth()];
  const startYear = d0.getFullYear();

  const endDay = d2.getDate();
  const endMonth = MONTH_NAMES[d2.getMonth()];
  const endYear = d2.getFullYear();

  if (startYear !== endYear) {
    return `${startDay} ${startMonth} ${startYear} – ${endDay} ${endMonth} ${endYear}`;
  }
  if (startMonth !== endMonth) {
    return `${startDay} ${startMonth} – ${endDay} ${endMonth} ${startYear}`;
  }
  return `${startDay} – ${endDay} ${startMonth} ${startYear}`;
}

/**
 * Steps a 3-day window forward or backward by 3 days.
 */
export function stepThreeDay(currentDate: string, direction: -1 | 1): string {
  return addDays(currentDate, direction * 3);
}

/**
 * Checks whether targetDate falls within the 3-day window starting at startDate.
 */
export function isDateInThreeDayWindow(targetDate: string, startDate: string): boolean {
  const windowDays = threeDayDates(startDate);
  return windowDays.includes(targetDate);
}

/**
 * Computes pixels per minute for phone view grids.
 * Ensures a slot of slotMinutes is always at least 44px tall (minimum touch target).
 * Standard base is 1.6 px/min (96px/hour).
 */
export function phonePxPerMinute(slotMinutes: number): number {
  const safeMinutes = Math.max(1, slotMinutes);
  return Math.max(1.6, 44 / safeMinutes);
}

export type ScheduleBlockDensity = 'full' | 'medium' | 'compact';

/**
 * Calculates adaptive density for schedule blocks based on column width and block height.
 * - >= 150px: 'full' (patient name, time range, short reason)
 * - 110–149px: 'medium' (name + start time)
 * - < 110px: 'compact' (name only)
 * - blocks shorter than ~34px: 'compact' regardless of width
 */
export function densityFor(columnWidthPx: number, blockHeightPx?: number): ScheduleBlockDensity {
  if (blockHeightPx !== undefined && blockHeightPx < 34) {
    return 'compact';
  }
  if (columnWidthPx >= 150) {
    return 'full';
  }
  if (columnWidthPx >= 110) {
    return 'medium';
  }
  return 'compact';
}

/**
 * Resolves the selected therapist IDs based on user role and search param.
 * - Role 'therapist': Defaults to [myTherapistId]. If search param specifies therapists,
 *   filters to roster and guarantees myTherapistId is preserved.
 * - Other roles (admin, front desk): Filters search param to roster, or returns [] if unset (showing all).
 */
export function selectedTherapistIds(
  role: string | undefined,
  myTherapistId: string | null | undefined,
  searchTherapist: string | undefined,
  rosterIds: string[]
): string[] {
  const validSet = new Set(rosterIds);

  if (role === 'therapist') {
    if (!searchTherapist) {
      return myTherapistId && validSet.has(myTherapistId) ? [myTherapistId] : [];
    }
    const filtered = searchTherapist
      .split(',')
      .map((id) => id.trim())
      .filter((id) => validSet.has(id));

    // Ensure therapist's own ID is always included
    if (myTherapistId && validSet.has(myTherapistId) && !filtered.includes(myTherapistId)) {
      filtered.unshift(myTherapistId);
    }
    return filtered;
  }

  // Admin / Front desk / others
  if (!searchTherapist) {
    return [];
  }
  return searchTherapist
    .split(',')
    .map((id) => id.trim())
    .filter((id) => validSet.has(id));
}

/**
 * Toggles a therapist ID in the selection list.
 * Rules:
 * - If role === 'therapist' and id === myTherapistId: cannot be removed (no-op).
 * - For role === 'therapist': starting base defaults to [myTherapistId] if empty.
 * - For other roles: starting base defaults to all roster IDs if empty.
 * - Always ensures myTherapistId remains in the selection for role 'therapist'.
 */
export function toggleTherapistSelection(
  id: string,
  currentSelected: string[],
  allRosterIds: string[],
  role: string | undefined,
  myTherapistId: string | null | undefined
): string[] {
  const isTherapist = role === 'therapist';
  if (isTherapist && myTherapistId && id === myTherapistId) {
    return currentSelected.length ? currentSelected : [myTherapistId];
  }

  const base = currentSelected.length
    ? currentSelected
    : isTherapist && myTherapistId
      ? [myTherapistId]
      : allRosterIds;

  const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
  if (isTherapist && myTherapistId && !next.includes(myTherapistId)) {
    next.unshift(myTherapistId);
  }
  return next.length ? next : [id];
}

/**
 * Computes the search param value for therapist filter.
 * Rules:
 * - For role === 'therapist':
 *   - Only valid roster IDs are kept.
 *   - myTherapistId is guaranteed to be present if provided.
 *   - If any colleague is selected, returns explicit comma-separated IDs (e.g. "myId,colleague1,colleague2").
 *     Crucially: does NOT collapse to undefined when all therapists are selected, because undefined
 *     means "own column only" for therapists.
 *   - If only own column is selected (no colleagues), returns undefined (clean URL).
 * - For other roles (admin, front desk):
 *   - If 1 to (roster.length - 1) therapists selected, returns comma-separated IDs.
 *   - If 0 or all therapists selected, returns undefined (meaning show all).
 */
export function nextTherapistSearchParam(
  selectedIds: string[],
  allRosterIds: string[],
  role: string | undefined,
  myTherapistId: string | null | undefined
): string | undefined {
  const rosterSet = new Set(allRosterIds);
  const isTherapist = role === 'therapist';

  if (isTherapist) {
    const cleaned = selectedIds.filter((id) => rosterSet.has(id));
    if (myTherapistId && rosterSet.has(myTherapistId) && !cleaned.includes(myTherapistId)) {
      cleaned.unshift(myTherapistId);
    }
    const hasColleagues = cleaned.some((id) => id !== myTherapistId);
    return hasColleagues ? cleaned.join(',') : undefined;
  }

  const valid = selectedIds.filter((id) => rosterSet.has(id));
  return valid.length > 0 && valid.length < allRosterIds.length ? valid.join(',') : undefined;
}

/**
 * Checks whether the current user has permission to manage (book, move, cancel) an appointment.
 */
export function canManageAppointment(
  appointment: { therapistId: string | null },
  myTherapistId: string | null | undefined,
  isClinicWideView: boolean
): boolean {
  return isClinicWideView || (Boolean(myTherapistId) && appointment.therapistId === myTherapistId);
}

/**
 * Checks whether an appointment belongs to a colleague (read-only for therapists).
 */
export function isColleagueAppointment(
  appointment: { therapistId: string | null },
  role: string | undefined,
  myTherapistId: string | null | undefined
): boolean {
  return (
    role === 'therapist' &&
    Boolean(myTherapistId) &&
    appointment.therapistId !== null &&
    appointment.therapistId !== myTherapistId
  );
}

