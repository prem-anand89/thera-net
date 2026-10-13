import { describe, expect, it } from 'vitest';
import { computeMySchedule, formatScheduleDate } from './useMySchedule';
import type { Clinic, ShiftTemplate, TherapistShiftAssignment, WorkingHours } from '@/domain/types';

describe('formatScheduleDate', () => {
  it('formats ISO timestamps to "D MMM YYYY"', () => {
    expect(formatScheduleDate('2026-10-13T10:00:00Z')).toBe('13 Oct 2026');
    expect(formatScheduleDate('2026-01-05T00:00:00Z')).toBe('5 Jan 2026');
  });
});

describe('computeMySchedule', () => {
  const clinic: Pick<Clinic, 'bookingStartHour' | 'bookingEndHour' | 'closedWeekdays'> = {
    bookingStartHour: 9,
    bookingEndHour: 17,
    closedWeekdays: [0], // Sunday closed
  };

  const morningTemplate: ShiftTemplate = {
    id: 't-morning',
    clinicId: 'c1',
    name: 'Morning Shift',
    startMinute: 540,
    endMinute: 780,
    breakDurationMinutes: 0,
    defaultBreakStartMinute: null,
    active: true,
    updatedAt: '2026-10-01T00:00:00Z',
  };

  it('computes headline and summary for template, custom, and clinic default schedules', () => {
    const approvedRow: TherapistShiftAssignment = {
      id: 'a1',
      clinicId: 'c1',
      therapistId: 'th1',
      shiftTemplateId: 't-morning',
      customHours: null,
      weekdays: [1, 2, 3, 4, 5],
      breakStartMinute: null,
      status: 'approved',
      note: null,
      decisionNote: null,
      requestedBy: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    };

    const templateSchedule = computeMySchedule({
      therapistId: 'th1',
      workingHours: {
        '1': [[540, 780]],
        '2': [[540, 780]],
        '3': [[540, 780]],
        '4': [[540, 780]],
        '5': [[540, 780]],
      },
      assignments: [approvedRow],
      templates: [morningTemplate],
      clinic,
    });
    expect(templateSchedule.headline).toBe('Morning Shift (Mon–Fri)');
    expect(templateSchedule.summary).toBe('Mon–Fri 9–1');

    const customSchedule = computeMySchedule({
      therapistId: 'th1',
      workingHours: {
        '2': [[600, 780]],
        '6': [[600, 780]],
      },
      assignments: [],
      templates: [],
      clinic,
    });
    expect(customSchedule.headline).toBe('Custom hours');
    expect(customSchedule.summary).toBe('Tue, Sat 10–1');

    const defaultSchedule = computeMySchedule({
      therapistId: 'th1',
      workingHours: null,
      assignments: [],
      templates: [],
      clinic,
    });
    expect(defaultSchedule.headline).toBe('Clinic default hours');
    expect(defaultSchedule.summary).toBe('Mon–Sat 9–5');
  });

  it('builds weekList Mon..Sun with formatted ranges, Off, and Closed', () => {
    const splitHours: WorkingHours = {
      '1': [[540, 810], [870, 960]], // Mon 9:00 AM–1:30 PM, 2:30 PM–4:00 PM
      '2': [], // Tue Off
      '3': [[540, 780]], // Wed 9:00 AM–1:00 PM
    };

    const res = computeMySchedule({
      therapistId: 'th1',
      workingHours: splitHours,
      assignments: [],
      templates: [],
      clinic,
    });

    expect(res.weekList).toHaveLength(7);
    expect(res.weekList[0]).toEqual({
      weekday: 1,
      label: 'Mon',
      text: '9:00 AM – 1:30 PM, 2:30 PM – 4:00 PM',
    });
    expect(res.weekList[1]).toEqual({
      weekday: 2,
      label: 'Tue',
      text: 'Off',
    });
    expect(res.weekList[2]).toEqual({
      weekday: 3,
      label: 'Wed',
      text: '9:00 AM – 1:00 PM',
    });
    // Thu, Fri, Sat are not in customHours -> Off
    expect(res.weekList[3]).toEqual({ weekday: 4, label: 'Thu', text: 'Off' });
    // Sun is closed clinic day
    expect(res.weekList[6]).toEqual({ weekday: 0, label: 'Sun', text: 'Closed' });
  });

  it('builds weekList for null workingHours using clinic hours on open days and Closed on closed days', () => {
    const res = computeMySchedule({
      therapistId: 'th1',
      workingHours: null,
      assignments: [],
      templates: [],
      clinic,
    });

    expect(res.weekList[0]).toEqual({
      weekday: 1,
      label: 'Mon',
      text: '9:00 AM – 5:00 PM',
    });
    expect(res.weekList[6]).toEqual({
      weekday: 0,
      label: 'Sun',
      text: 'Closed',
    });
  });

  it('identifies newest pending request and formats title with template and weekdays', () => {
    const pendingRow: TherapistShiftAssignment = {
      id: 'p1',
      clinicId: 'c1',
      therapistId: 'th1',
      shiftTemplateId: 't-morning',
      customHours: null,
      weekdays: [1, 2, 3, 4, 5],
      breakStartMinute: null,
      status: 'pending',
      note: null,
      decisionNote: null,
      requestedBy: 'th1',
      decidedBy: null,
      decidedAt: null,
      createdAt: '2026-10-10T08:00:00Z',
      updatedAt: '2026-10-10T08:00:00Z',
    };

    const res = computeMySchedule({
      therapistId: 'th1',
      workingHours: null,
      assignments: [pendingRow],
      templates: [morningTemplate],
      clinic,
    });

    expect(res.pending).toEqual({
      id: 'p1',
      title: 'Morning Shift (Mon–Fri)',
      sentAt: '2026-10-10T08:00:00Z',
    });
  });

  it('identifies newest declined request and handles decisionNote presence and newer pending suppression', () => {
    const declinedWithNote: TherapistShiftAssignment = {
      id: 'd1',
      clinicId: 'c1',
      therapistId: 'th1',
      shiftTemplateId: 't-morning',
      customHours: null,
      weekdays: [6], // Sat
      breakStartMinute: null,
      status: 'declined',
      note: null,
      decisionNote: 'Not enough staffing on Saturdays',
      requestedBy: 'th1',
      decidedBy: 'admin-1',
      decidedAt: '2026-10-10T12:00:00Z',
      createdAt: '2026-10-09T08:00:00Z',
      updatedAt: '2026-10-10T12:00:00Z',
    };

    const res = computeMySchedule({
      therapistId: 'th1',
      workingHours: null,
      assignments: [declinedWithNote],
      templates: [morningTemplate],
      clinic,
    });

    expect(res.declined).toEqual({
      id: 'd1',
      title: 'Morning Shift (Sat)',
      decidedAt: '2026-10-10T12:00:00Z',
      decisionNote: 'Not enough staffing on Saturdays',
    });

    // When therapist sends a newer pending request AFTER the decline was decided, decline is suppressed
    const newerPending: TherapistShiftAssignment = {
      id: 'p2',
      clinicId: 'c1',
      therapistId: 'th1',
      shiftTemplateId: 't-morning',
      customHours: null,
      weekdays: [1, 2],
      breakStartMinute: null,
      status: 'pending',
      note: null,
      decisionNote: null,
      requestedBy: 'th1',
      decidedBy: null,
      decidedAt: null,
      createdAt: '2026-10-11T09:00:00Z', // After 2026-10-10T12:00:00Z
      updatedAt: '2026-10-11T09:00:00Z',
    };

    const resWithNewerPending = computeMySchedule({
      therapistId: 'th1',
      workingHours: null,
      assignments: [declinedWithNote, newerPending],
      templates: [morningTemplate],
      clinic,
    });

    expect(resWithNewerPending.declined).toBeNull();
    expect(resWithNewerPending.pending?.id).toBe('p2');
  });

  describe('lastChange notice wording', () => {
    it('wording for admin direct assignment: "Changed by your clinic admin on <date>"', () => {
      const adminAssignedRow: TherapistShiftAssignment = {
        id: 'a1',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: 't-morning',
        customHours: null,
        weekdays: [1, 2, 3],
        breakStartMinute: null,
        status: 'approved',
        note: null,
        decisionNote: null,
        requestedBy: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '2026-10-05T10:00:00Z',
        updatedAt: '2026-10-05T10:00:00Z',
      };

      const res = computeMySchedule({
        therapistId: 'th1',
        workingHours: null,
        assignments: [adminAssignedRow],
        templates: [morningTemplate],
        clinic,
      });

      expect(res.lastChange).toEqual({
        at: '2026-10-05T10:00:00Z',
        text: 'Changed by your clinic admin on 5 Oct 2026',
      });
    });

    it('wording for approved therapist request: "Your request was approved on <date>"', () => {
      const approvedRequestRow: TherapistShiftAssignment = {
        id: 'a1',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: 't-morning',
        customHours: null,
        weekdays: [1, 2, 3],
        breakStartMinute: null,
        status: 'approved',
        note: null,
        decisionNote: null,
        requestedBy: 'user-th1',
        decidedBy: 'admin-1',
        decidedAt: '2026-10-08T14:00:00Z',
        createdAt: '2026-10-07T10:00:00Z',
        updatedAt: '2026-10-08T14:00:00Z',
      };

      const res = computeMySchedule({
        therapistId: 'th1',
        workingHours: null,
        assignments: [approvedRequestRow],
        templates: [morningTemplate],
        clinic,
      });

      expect(res.lastChange).toEqual({
        at: '2026-10-08T14:00:00Z',
        text: 'Your request was approved on 8 Oct 2026',
      });
    });

    it('wording for template edit: "<Shift name> was updated on <date>"', () => {
      const approvedRow: TherapistShiftAssignment = {
        id: 'a1',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: 't-morning',
        customHours: null,
        weekdays: [1, 2, 3],
        breakStartMinute: null,
        status: 'approved',
        note: null,
        decisionNote: null,
        requestedBy: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      };

      const editedTemplate: ShiftTemplate = {
        ...morningTemplate,
        updatedAt: '2026-10-12T16:00:00Z', // Later than assignment row
      };

      const res = computeMySchedule({
        therapistId: 'th1',
        workingHours: null,
        assignments: [approvedRow],
        templates: [editedTemplate],
        clinic,
      });

      expect(res.lastChange).toEqual({
        at: '2026-10-12T16:00:00Z',
        text: 'Morning Shift was updated on 12 Oct 2026',
      });
    });

    it('wording for reset to clinic default via superseded row: "Reset to clinic default on <date>"', () => {
      const supersededRow: TherapistShiftAssignment = {
        id: 'a1',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: 't-morning',
        customHours: null,
        weekdays: [1, 2, 3],
        breakStartMinute: null,
        status: 'superseded',
        note: null,
        decisionNote: null,
        requestedBy: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-11T11:00:00Z', // Reset timestamp
      };

      const res = computeMySchedule({
        therapistId: 'th1',
        workingHours: null,
        assignments: [supersededRow],
        templates: [morningTemplate],
        clinic,
      });

      expect(res.lastChange).toEqual({
        at: '2026-10-11T11:00:00Z',
        text: 'Reset to clinic default on 11 Oct 2026',
      });
    });
  });
});
