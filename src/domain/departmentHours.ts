import type { Clinic, ClinicClosedDate, WorkingHours } from './types';
import type { Department } from './departments';
import type { ClinicHoursInput } from './schedule';

/**
 * Booking hours per department. OP is the clinic's own columns (start/end hour, operating intervals, closed weekdays,
 * slot length, start step); Home care and IP are optional overrides in `clinic.departmentHours` and every field they leave
 * out follows OP. This is the one place that inheritance is decided: the schedule, booking and workspace code read hours
 * through here, never `clinic.slotDurationMinutes` / `bookingStartHour` directly.
 */
export interface ResolvedDepartmentHours {
  clinicHours: ClinicHoursInput;
  slotMinutes: number;
  /** Staff start times come every this many minutes. */
  startStepMinutes: number;
  closedWeekdays: number[];
}

type ClinicHoursSource = Pick<
  Clinic,
  | 'bookingStartHour'
  | 'bookingEndHour'
  | 'operatingHours'
  | 'closedWeekdays'
  | 'slotDurationMinutes'
  | 'startStepMinutes'
  | 'departmentHours'
>;

const isHour = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 24;
const isMinutes = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 5 && n <= 240;

export function departmentHours(clinic: ClinicHoursSource, department: Department): ResolvedDepartmentHours {
  const slotMinutes = clinic.slotDurationMinutes || 30;
  const op: ResolvedDepartmentHours = {
    clinicHours: {
      startHour: clinic.bookingStartHour ?? 9,
      endHour: clinic.bookingEndHour ?? 17,
      operating: clinic.operatingHours ?? null,
    },
    slotMinutes,
    startStepMinutes: clinic.startStepMinutes || 15,
    closedWeekdays: clinic.closedWeekdays ?? [],
  };
  if (department === 'clinic') return op;

  const o = clinic.departmentHours?.[department];
  if (!o || typeof o !== 'object') return op;

  const startHour = isHour(o.startHour) ? o.startHour : op.clinicHours.startHour;
  const endHour = isHour(o.endHour) ? o.endHour : op.clinicHours.endHour;
  // A nonsense window (end not after start) is ignored as a whole rather than half applied.
  const windowOk = endHour > startHour;
  const slot = isMinutes(o.slotMinutes) ? o.slotMinutes : op.slotMinutes;
  // Its own hours, else (when it set its own window) one plain block, else OP's: a lunch break in OP's `operating`
  // does not carry over to a window the department changed.
  const ownWindow = windowOk && (isHour(o.startHour) || isHour(o.endHour));
  const operating: WorkingHours | null = o.operating !== undefined
    ? o.operating
    : ownWindow
      ? null
      : op.clinicHours.operating ?? null;
  return {
    clinicHours: windowOk
      ? { startHour, endHour, operating }
      : { ...op.clinicHours, operating: o.operating !== undefined ? o.operating : op.clinicHours.operating },
    slotMinutes: slot,
    startStepMinutes:
      typeof o.startStepMinutes === 'number' && o.startStepMinutes > 0
        ? o.startStepMinutes
        : isMinutes(o.slotMinutes)
          ? o.slotMinutes
          : op.startStepMinutes,
    closedWeekdays: Array.isArray(o.closedWeekdays) ? o.closedWeekdays : op.closedWeekdays,
  };
}

/** A holiday applies to the department unless it names departments and this one is not among them. */
export function closedDateAppliesTo(closed: Pick<ClinicClosedDate, 'departments'>, department: Department): boolean {
  const list = closed.departments;
  return !list || list.length === 0 || list.includes(department);
}

/** Is the department closed on a date, by its closed weekdays or a holiday that applies to it? */
export function isDepartmentClosedOn(
  clinic: ClinicHoursSource,
  department: Department,
  date: string,
  closedDates: readonly Pick<ClinicClosedDate, 'closedDate' | 'departments'>[]
): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  if (departmentHours(clinic, department).closedWeekdays.includes(weekday)) return true;
  return closedDates.some((c) => c.closedDate === date && closedDateAppliesTo(c, department));
}
