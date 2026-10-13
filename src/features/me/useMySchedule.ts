import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { repos } from '@/services';
import {
  describeSchedule,
  formatDayRanges,
  formatRange12h,
  sortWeekdays,
  WEEKDAY_META,
  WEEKDAY_ORDER,
} from '@/features/settings/shiftUtils';
import type {
  Clinic,
  ShiftTemplate,
  TherapistShiftAssignment,
  WorkingHours,
} from '@/domain/types';

export type MySchedule = {
  headline: string;
  summary: string;
  weekList: { weekday: number; label: string; text: string }[];
  pending: { id: string; title: string; sentAt: string } | null;
  declined: { id: string; title: string; decidedAt: string; decisionNote: string | null } | null;
  lastChange: { at: string; text: string } | null;
};

export function formatScheduleDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

export function computeMySchedule({
  therapistId: _therapistId,
  workingHours,
  assignments,
  templates,
  clinic,
}: {
  therapistId: string;
  workingHours: WorkingHours | null;
  assignments: TherapistShiftAssignment[];
  templates: ShiftTemplate[];
  clinic: Pick<Clinic, 'bookingStartHour' | 'bookingEndHour' | 'closedWeekdays'>;
}): MySchedule {
  const desc = describeSchedule({ workingHours }, assignments, templates, clinic);

  const hasCustomWh =
    workingHours !== null &&
    workingHours !== undefined &&
    typeof workingHours === 'object';
  const wh = hasCustomWh ? (workingHours as Record<string, [number, number][]>) : null;
  const clinicStart = (clinic.bookingStartHour ?? 9) * 60;
  const clinicEnd = (clinic.bookingEndHour ?? 17) * 60;
  const closedDays = new Set(clinic.closedWeekdays ?? []);

  // 1. Mon..Sun week list
  const weekList = WEEKDAY_ORDER.map((weekday) => {
    const label = WEEKDAY_META[weekday]?.short ?? String(weekday);
    if (wh) {
      const intervals = wh[String(weekday)] ?? [];
      if (intervals.length > 0) {
        const text = intervals.map(([s, e]) => formatRange12h(s, e)).join(', ');
        return { weekday, label, text };
      }
      if (closedDays.has(weekday)) {
        return { weekday, label, text: 'Closed' };
      }
      return { weekday, label, text: 'Off' };
    } else {
      if (closedDays.has(weekday)) {
        return { weekday, label, text: 'Closed' };
      }
      return { weekday, label, text: formatRange12h(clinicStart, clinicEnd) };
    }
  });

  // 2. Pending request (newest pending row)
  let pending: MySchedule['pending'] = null;
  const pendingRows = assignments
    .filter((a) => a.status === 'pending')
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  if (pendingRows.length > 0) {
    const p = pendingRows[0];
    let title = 'Custom hours';
    if (p.shiftTemplateId) {
      const tmpl = templates.find((t) => t.id === p.shiftTemplateId);
      const name = tmpl?.name ?? 'Assigned Shift';
      if (p.weekdays && p.weekdays.length > 0) {
        title = `${name} (${formatDayRanges(sortWeekdays(p.weekdays))})`;
      } else {
        title = name;
      }
    }
    pending = {
      id: p.id,
      title,
      sentAt: p.createdAt,
    };
  }

  // 3. Declined request
  // newest declined row decided after newest pending row's creation (or when no pending)
  let declined: MySchedule['declined'] = null;
  const declinedRows = assignments
    .filter((a) => a.status === 'declined')
    .sort((a, b) => {
      const timeA = a.decidedAt || a.updatedAt || a.createdAt || '';
      const timeB = b.decidedAt || b.updatedAt || b.createdAt || '';
      return timeB.localeCompare(timeA);
    });

  if (declinedRows.length > 0) {
    const d = declinedRows[0];
    const decidedTimestamp = d.decidedAt || d.updatedAt || d.createdAt || '';
    const pendingSent = pending?.sentAt || '';
    // Show only if decided after the newest pending row was sent (or if no pending request)
    if (!pending || decidedTimestamp > pendingSent) {
      let title = 'Custom hours';
      if (d.shiftTemplateId) {
        const tmpl = templates.find((t) => t.id === d.shiftTemplateId);
        const name = tmpl?.name ?? 'Assigned Shift';
        if (d.weekdays && d.weekdays.length > 0) {
          title = `${name} (${formatDayRanges(sortWeekdays(d.weekdays))})`;
        } else {
          title = name;
        }
      }
      declined = {
        id: d.id,
        title,
        decidedAt: decidedTimestamp,
        decisionNote: d.decisionNote ?? null,
      };
    }
  }

  // 4. Last change notice
  // Latest updatedAt among approved and superseded assignments and the templates they are on
  type ChangeEvent = { at: string; text: string; priority: number };
  const events: ChangeEvent[] = [];

  const approvedRows = assignments.filter((a) => a.status === 'approved');
  for (const a of approvedRows) {
    const at = a.updatedAt || a.createdAt;
    if (!at) continue;
    const dateStr = formatScheduleDate(at);
    if (a.requestedBy) {
      events.push({ at, text: `Your request was approved on ${dateStr}`, priority: 2 });
    } else {
      events.push({ at, text: `Changed by your clinic admin on ${dateStr}`, priority: 2 });
    }

    // Check template edits for this approved shift
    if (a.shiftTemplateId) {
      const tmpl = templates.find((t) => t.id === a.shiftTemplateId);
      if (tmpl && tmpl.updatedAt) {
        events.push({
          at: tmpl.updatedAt,
          text: `${tmpl.name} was updated on ${formatScheduleDate(tmpl.updatedAt)}`,
          priority: 1,
        });
      }
    }
  }

  // Superseded rows (e.g. reset to clinic default)
  const supersededRows = assignments.filter((a) => a.status === 'superseded');
  for (const s of supersededRows) {
    const at = s.updatedAt || s.createdAt;
    if (!at) continue;
    events.push({
      at,
      text: `Reset to clinic default on ${formatScheduleDate(at)}`,
      priority: 0,
    });
  }

  let lastChange: MySchedule['lastChange'] = null;
  if (events.length > 0) {
    // Sort descending by timestamp; if equal, prefer higher priority (approved over superseded)
    events.sort((e1, e2) => {
      const timeDiff = e2.at.localeCompare(e1.at);
      if (timeDiff !== 0) return timeDiff;
      return e2.priority - e1.priority;
    });
    lastChange = {
      at: events[0].at,
      text: events[0].text,
    };
  }

  return {
    headline: desc.headline,
    summary: desc.summary,
    weekList,
    pending,
    declined,
    lastChange,
  };
}

export function useMySchedule(
  therapistId: string,
  clinicId: string,
  workingHours: WorkingHours | null,
  clinicOverride?: Pick<Clinic, 'bookingStartHour' | 'bookingEndHour' | 'closedWeekdays'>
): MySchedule | undefined {
  let contextClinic: Clinic | null = null;
  try {
    contextClinic = useClinic();
  } catch {
    // outside ClinicContext
  }
  const clinic = clinicOverride ?? contextClinic;

  const assignments = useLiveQuery(
    () =>
      therapistId
        ? repos.therapistShiftAssignments.listByTherapist(therapistId)
        : Promise.resolve([]),
    [therapistId]
  );
  const templates = useLiveQuery(
    () => (clinicId ? repos.shiftTemplates.list(clinicId, true) : Promise.resolve([])),
    [clinicId]
  );

  if (!clinic || !assignments || !templates) return undefined;

  return computeMySchedule({
    therapistId,
    workingHours,
    assignments,
    templates,
    clinic,
  });
}
