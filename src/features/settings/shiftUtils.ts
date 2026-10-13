import type {
  Clinic,
  ShiftTemplate,
  Therapist,
  TherapistShiftAssignment,
  WorkingHours,
} from '@/domain/types';

/** Weekday order starting Monday, matching schedule calendar. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const WEEKDAY_META: Record<number, { short: string; full: string }> = {
  1: { short: 'Mon', full: 'Monday' },
  2: { short: 'Tue', full: 'Tuesday' },
  3: { short: 'Wed', full: 'Wednesday' },
  4: { short: 'Thu', full: 'Thursday' },
  5: { short: 'Fri', full: 'Friday' },
  6: { short: 'Sat', full: 'Saturday' },
  0: { short: 'Sun', full: 'Sunday' },
};

/** Deterministic palette for shift template chips */
export const SHIFT_PALETTES = [
  { bg: 'bg-[#e6f4f1]', text: 'text-[#1b5e54]', border: 'border-[#9fd3c7]', hex: '#2c5f63' },
  { bg: 'bg-[#e8edf9]', text: 'text-[#1e3a8a]', border: 'border-[#a5b4fc]', hex: '#3b82f6' },
  { bg: 'bg-[#fef3c7]', text: 'text-[#92400e]', border: 'border-[#fcd34d]', hex: '#f59e0b' },
  { bg: 'bg-[#ecfdf5]', text: 'text-[#065f46]', border: 'border-[#6ee7b7]', hex: '#10b981' },
  { bg: 'bg-[#f5f3ff]', text: 'text-[#5b21b6]', border: 'border-[#c4b5fd]', hex: '#8b5cf6' },
  { bg: 'bg-[#fff1f2]', text: 'text-[#9f1239]', border: 'border-[#fda4af]', hex: '#f43f5e' },
  { bg: 'bg-[#f0f9ff]', text: 'text-[#0369a1]', border: 'border-[#7dd3fc]', hex: '#0ea5e9' },
  { bg: 'bg-[#fef9c3]', text: 'text-[#854d0e]', border: 'border-[#fde047]', hex: '#eab308' },
];

export function getTemplatePalette(indexOrId: number | string) {
  let idx = 0;
  if (typeof indexOrId === 'number') {
    idx = Math.abs(indexOrId);
  } else {
    let hash = 0;
    for (let i = 0; i < indexOrId.length; i++) {
      hash = (hash << 5) - hash + indexOrId.charCodeAt(i);
      hash |= 0;
    }
    idx = Math.abs(hash);
  }
  return SHIFT_PALETTES[idx % SHIFT_PALETTES.length];
}

/** Formats minutes from midnight into 12-hour format: 540 -> '9:00 AM' */
export function format12h(minute: number): string {
  const h = Math.floor(minute / 60);
  const min = minute % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min.toString().padStart(2, '0')} ${period}`;
}

/** Formats a minute range into 12-hour: (540, 1020) -> '9:00 AM – 5:00 PM' */
export function formatRange12h(startMinute: number, endMinute: number): string {
  return `${format12h(startMinute)} – ${format12h(endMinute)}`;
}

/** Converts "HH:MM" 24h string to minutes from midnight */
export function timeInputToMinutes(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Converts minutes from midnight to "HH:MM" 24h string for input type="time" */
export function minutesToTimeInput(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
}

/** Formats break duration e.g. 60 -> '1h break', 45 -> '45m break', 90 -> '1h 30m break' */
export function formatBreakDuration(minutes: number): string {
  if (minutes <= 0) return 'No break';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m break`;
  if (h > 0) return `${h}h break`;
  return `${m}m break`;
}

/** Formats break summary with start time if available: '1h break @ 1:00 PM' */
export function formatBreakSummary(
  breakDurationMinutes: number,
  breakStartMinute: number | null
): string {
  if (breakDurationMinutes <= 0) return 'No break';
  const dur = formatBreakDuration(breakDurationMinutes);
  if (breakStartMinute !== null) {
    return `${dur} @ ${format12h(breakStartMinute)}`;
  }
  return dur;
}

export type ShiftSummaryResult = {
  summary: string;
  isSplit: boolean;
  splitDetails?: string;
  workingMinutes: number;
};

/**
 * Formats template details. Recognizes Split Shifts when break duration >= 120 mins (2h).
 */
export function formatShiftSummary(template: ShiftTemplate): ShiftSummaryResult {
  const totalMinutes = template.endMinute - template.startMinute;
  const workingMinutes = Math.max(0, totalMinutes - template.breakDurationMinutes);
  const isSplit = template.breakDurationMinutes >= 120;

  if (isSplit && template.defaultBreakStartMinute !== null) {
    const breakStart = template.defaultBreakStartMinute;
    const breakEnd = breakStart + template.breakDurationMinutes;
    const splitDurHours = (template.breakDurationMinutes / 60).toFixed(
      template.breakDurationMinutes % 60 === 0 ? 0 : 1
    );
    const splitDetails = `Morning: ${formatRange12h(
      template.startMinute,
      breakStart
    )} & Evening: ${formatRange12h(breakEnd, template.endMinute)} (${splitDurHours}h split)`;
    return {
      summary: `${template.name} · ${splitDetails}`,
      isSplit: true,
      splitDetails,
      workingMinutes,
    };
  }

  const range = formatRange12h(template.startMinute, template.endMinute);
  const breakStr = formatBreakSummary(
    template.breakDurationMinutes,
    template.defaultBreakStartMinute
  );
  return {
    summary: `${template.name} (${range}, ${breakStr})`,
    isSplit: false,
    workingMinutes,
  };
}

/** Sorts weekday numbers according to Monday-first order [1, 2, 3, 4, 5, 6, 0] */
export function sortWeekdays(weekdays: number[]): number[] {
  const orderMap = new Map<number, number>(WEEKDAY_ORDER.map((d, i) => [d, i]));
  return [...weekdays].sort((a, b) => (orderMap.get(a) ?? 99) - (orderMap.get(b) ?? 99));
}

/** Formats a list of weekdays into sorted readable text: e.g. [3, 1] -> 'Mon/Wed' */
export function formatWeekdays(weekdays: number[]): string {
  return sortWeekdays(weekdays)
    .map((d) => WEEKDAY_META[d]?.short ?? String(d))
    .join('/');
}

export type CoverageCell = {
  therapistId: string;
  weekday: number;
  type: 'template' | 'custom' | 'off' | 'clinic_default' | 'clinic_closed';
  templates: { template: ShiftTemplate; assignment: TherapistShiftAssignment }[];
  customIntervals: [number, number][] | null;
  label: string;
  tooltip: string;
  workingMinutes: number;
};

/**
 * Builds weekly coverage map for therapists across weekdays 1..6, 0.
 */
export function buildCoverage(
  therapists: Therapist[],
  assignments: TherapistShiftAssignment[],
  templates: ShiftTemplate[],
  clinic: Pick<Clinic, 'bookingStartHour' | 'bookingEndHour' | 'closedWeekdays'>
): Map<string, Map<number, CoverageCell>> {
  const templateById = new Map<string, ShiftTemplate>(templates.map((t) => [t.id, t]));
  const approvedByTherapist = new Map<string, TherapistShiftAssignment[]>();

  for (const a of assignments) {
    if (a.status !== 'approved') continue;
    const list = approvedByTherapist.get(a.therapistId);
    if (list) list.push(a);
    else approvedByTherapist.set(a.therapistId, [a]);
  }

  const result = new Map<string, Map<number, CoverageCell>>();
  const clinicStart = (clinic.bookingStartHour ?? 9) * 60;
  const clinicEnd = (clinic.bookingEndHour ?? 18) * 60;
  const clinicDefaultMinutes = Math.max(0, clinicEnd - clinicStart);
  const closedDays = new Set(clinic.closedWeekdays ?? []);

  for (const therapist of therapists) {
    const dayMap = new Map<number, CoverageCell>();
    const therapistApproved = approvedByTherapist.get(therapist.id) ?? [];

    for (const weekday of WEEKDAY_ORDER) {
      // 1. Check for shift template assignments on this weekday
      const matchingAssignments = therapistApproved.filter(
        (a) => a.shiftTemplateId && a.weekdays?.includes(weekday)
      );

      if (matchingAssignments.length > 0) {
        const assignedList = matchingAssignments.map((a) => ({
          template: templateById.get(a.shiftTemplateId!)!,
          assignment: a,
        })).filter((x) => Boolean(x.template));

        const totalMins = assignedList.reduce((sum, item) => {
          const shiftMins = item.template.endMinute - item.template.startMinute;
          return sum + Math.max(0, shiftMins - item.template.breakDurationMinutes);
        }, 0);

        const label = assignedList.map((x) => x.template.name).join(' + ');
        const tooltip = assignedList
          .map((x) => {
            const shift = formatShiftSummary(x.template);
            return shift.isSplit && shift.splitDetails ? shift.splitDetails : shift.summary;
          })
          .join('\n');

        dayMap.set(weekday, {
          therapistId: therapist.id,
          weekday,
          type: 'template',
          templates: assignedList,
          customIntervals: null,
          label,
          tooltip,
          workingMinutes: totalMins,
        });
        continue;
      }

      // 2. Check for therapist custom working hours
      const wh = therapist.workingHours;
      const dayKey = String(weekday) as keyof WorkingHours;
      if (wh && dayKey in wh) {
        const intervals = wh[dayKey] ?? [];
        if (intervals.length === 0) {
          dayMap.set(weekday, {
            therapistId: therapist.id,
            weekday,
            type: 'off',
            templates: [],
            customIntervals: [],
            label: 'Off',
            tooltip: `${WEEKDAY_META[weekday]?.full}: Scheduled Off`,
            workingMinutes: 0,
          });
        } else {
          const mins = intervals.reduce((sum, [s, e]) => sum + Math.max(0, e - s), 0);
          const formatted = intervals
            .map(([s, e]) => formatRange12h(s, e))
            .join(' & ');
          dayMap.set(weekday, {
            therapistId: therapist.id,
            weekday,
            type: 'custom',
            templates: [],
            customIntervals: intervals,
            label: 'Custom',
            tooltip: `Custom hours: ${formatted}`,
            workingMinutes: mins,
          });
        }
        continue;
      }

      // 3. A therapist with any stored hours works only the listed days — the
      //    schedule treats a missing weekday as a day off, so the grid must too.
      if (wh && typeof wh === 'object') {
        dayMap.set(weekday, {
          therapistId: therapist.id,
          weekday,
          type: 'off',
          templates: [],
          customIntervals: [],
          label: 'Off',
          tooltip: `${WEEKDAY_META[weekday]?.full}: Not scheduled`,
          workingMinutes: 0,
        });
        continue;
      }

      // 4. No stored hours at all: clinic hours
      if (closedDays.has(weekday)) {
        dayMap.set(weekday, {
          therapistId: therapist.id,
          weekday,
          type: 'clinic_closed',
          templates: [],
          customIntervals: null,
          label: 'Closed',
          tooltip: `Clinic closed on ${WEEKDAY_META[weekday]?.full}`,
          workingMinutes: 0,
        });
      } else {
        dayMap.set(weekday, {
          therapistId: therapist.id,
          weekday,
          type: 'clinic_default',
          templates: [],
          customIntervals: null,
          label: 'Clinic default',
          tooltip: `Using clinic default hours (${formatRange12h(clinicStart, clinicEnd)})`,
          workingMinutes: clinicDefaultMinutes,
        });
      }
    }

    result.set(therapist.id, dayMap);
  }

  return result;
}

/**
 * Calculates weekly total hours and active shift days for a therapist.
 */
export function calculateWeeklyTotal(
  therapistId: string,
  coverageMap: Map<string, Map<number, CoverageCell>>
): {
  totalMinutes: number;
  totalHours: number;
  shiftsCount: number;
  isAllDefault: boolean;
  label: string;
} {
  const dayMap = coverageMap.get(therapistId);
  if (!dayMap) {
    return { totalMinutes: 0, totalHours: 0, shiftsCount: 0, isAllDefault: true, label: '0h' };
  }

  let totalMinutes = 0;
  let shiftsCount = 0;
  let defaultCount = 0;

  for (const weekday of WEEKDAY_ORDER) {
    const cell = dayMap.get(weekday);
    if (!cell) continue;
    if (cell.workingMinutes > 0) {
      totalMinutes += cell.workingMinutes;
      shiftsCount++;
    }
    if (cell.type === 'clinic_default' || cell.type === 'clinic_closed') {
      defaultCount++;
    }
  }

  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
  const isAllDefault = defaultCount === 7;

  let label = `${totalHours}h (${shiftsCount} shift${shiftsCount === 1 ? '' : 's'})`;
  if (isAllDefault) {
    label = `Clinic default (${totalHours}h)`;
  }

  return { totalMinutes, totalHours, shiftsCount, isAllDefault, label };
}

/**
 * Calculates daily clinic coverage for a weekday across all therapists.
 */
export function calculateDailyCoverage(
  weekday: number,
  coverageMap: Map<string, Map<number, CoverageCell>>,
  isClosed: boolean
): {
  staffCount: number;
  capacityHours: number;
  label: string;
} {
  if (isClosed) {
    return { staffCount: 0, capacityHours: 0, label: 'Clinic closed' };
  }

  let staffCount = 0;
  let capacityMinutes = 0;

  for (const dayMap of coverageMap.values()) {
    const cell = dayMap.get(weekday);
    if (cell && cell.workingMinutes > 0) {
      staffCount++;
      capacityMinutes += cell.workingMinutes;
    }
  }

  const capacityHours = Math.round((capacityMinutes / 60) * 10) / 10;
  const label = `${staffCount} on duty · ${capacityHours}h capacity`;

  return { staffCount, capacityHours, label };
}

/**
 * Returns list of therapist IDs that currently have approved assignments using this template.
 */
export function templateUsage(
  templateId: string,
  assignments: TherapistShiftAssignment[]
): string[] {
  const set = new Set<string>();
  for (const a of assignments) {
    if (a.shiftTemplateId === templateId && a.status === 'approved') {
      set.add(a.therapistId);
    }
  }
  return Array.from(set);
}

/**
 * Previews consequences before assigning a shift or resetting to clinic default.
 */
export function previewAssign({
  therapists,
  weekdays,
  template,
  isClinicDefault,
  existingApproved,
  existingPending,
  clinic,
}: {
  therapists: Therapist[];
  weekdays: number[];
  template?: ShiftTemplate | null;
  isClinicDefault?: boolean;
  existingApproved: TherapistShiftAssignment[];
  existingPending: TherapistShiftAssignment[];
  clinic: Pick<Clinic, 'bookingStartHour' | 'bookingEndHour'>;
}): {
  replaces: string[];
  closesPending: string[];
  workingTime: string;
} {
  const replaces: string[] = [];
  const closesPending: string[] = [];
  const weekdaySet = new Set(weekdays);

  for (const therapist of therapists) {
    // Check pending requests
    const pending = existingPending.find((p) => p.therapistId === therapist.id);
    if (pending) {
      closesPending.push(`Closes ${therapist.name}'s pending request`);
    }

    // If resetting to clinic default
    if (isClinicDefault) {
      const approved = existingApproved.filter((a) => a.therapistId === therapist.id);
      if (approved.length > 0) {
        replaces.push(`Replaces all assigned shifts for ${therapist.name}`);
      }
      if (therapist.workingHours) {
        replaces.push(`Replaces custom hours for ${therapist.name}`);
      }
      continue;
    }

    // If assigning a template
    if (template) {
      const approved = existingApproved.filter(
        (a) =>
          a.therapistId === therapist.id &&
          a.weekdays?.some((w) => weekdaySet.has(w))
      );
      for (const a of approved) {
        if (a.shiftTemplateId && a.shiftTemplateId !== template.id) {
          const overlapDays = a.weekdays?.filter((w) => weekdaySet.has(w)) ?? [];
          if (overlapDays.length > 0) {
            replaces.push(
              `Replaces ${formatWeekdays(overlapDays)} on ${therapist.name}'s schedule`
            );
          }
        }
      }

      // Check if custom hours exist for any chosen weekdays that are not already covered by an approved template
      if (therapist.workingHours) {
        const daysWithApprovedTemplate = new Set(
          existingApproved
            .filter((a) => a.therapistId === therapist.id && a.shiftTemplateId)
            .flatMap((a) => a.weekdays ?? [])
        );
        const customDays = weekdays.filter(
          (w) =>
            !daysWithApprovedTemplate.has(w) &&
            String(w) in (therapist.workingHours ?? {}) &&
            (therapist.workingHours as Record<string, unknown>)[String(w)] != null &&
            ((therapist.workingHours as Record<string, [number, number][]>)[String(w)] ?? []).length > 0
        );
        if (customDays.length > 0) {
          replaces.push(
            `Supersedes custom hours for ${formatWeekdays(customDays)} on ${therapist.name}`
          );
        }
      }
    }
  }

  let workingTime = '';
  if (isClinicDefault) {
    const start = (clinic.bookingStartHour ?? 9) * 60;
    const end = (clinic.bookingEndHour ?? 18) * 60;
    const hrs = Math.max(0, end - start) / 60;
    workingTime = `Clinic hours: ${hrs}h/day (${formatRange12h(start, end)})`;
  } else if (template) {
    const shift = formatShiftSummary(template);
    const hrs = (shift.workingMinutes / 60).toFixed(
      shift.workingMinutes % 60 === 0 ? 0 : 1
    );
    const totalHrs = ((template.endMinute - template.startMinute) / 60).toFixed(
      (template.endMinute - template.startMinute) % 60 === 0 ? 0 : 1
    );
    if (template.breakDurationMinutes > 0) {
      const breakHrs = (template.breakDurationMinutes / 60).toFixed(
        template.breakDurationMinutes % 60 === 0 ? 0 : 1
      );
      workingTime = `Working time: ${hrs}h/day (${totalHrs}h − ${breakHrs}h break)`;
    } else {
      workingTime = `Working time: ${hrs}h/day`;
    }
  }

  return { replaces, closesPending, workingTime };
}

/**
 * Validates template inputs client-side
 */
export function validateShiftTemplate(
  name: string,
  startMinute: number,
  endMinute: number,
  breakDurationMinutes: number,
  defaultBreakStartMinute: number | null
): { valid: boolean; error: string | null } {
  if (!name.trim()) {
    return { valid: false, error: 'Shift name is required.' };
  }
  if (endMinute <= startMinute) {
    return { valid: false, error: 'Shift end time must be after start time.' };
  }
  if (breakDurationMinutes < 0) {
    return { valid: false, error: 'Break duration cannot be negative.' };
  }
  const shiftLength = endMinute - startMinute;
  if (breakDurationMinutes > shiftLength) {
    return { valid: false, error: 'Break duration cannot exceed shift duration.' };
  }
  if (defaultBreakStartMinute !== null && breakDurationMinutes > 0) {
    if (defaultBreakStartMinute < startMinute) {
      return { valid: false, error: 'Break cannot start before the shift starts.' };
    }
    if (defaultBreakStartMinute + breakDurationMinutes > endMinute) {
      return { valid: false, error: 'Break must finish before the shift ends.' };
    }
  }
  return { valid: true, error: null };
}

/**
 * Clamps staff booking buffer hours to an integer between 0 and 12.
 */
export function clampBufferHours(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 3;
  return Math.max(0, Math.min(12, Math.round(value)));
}

