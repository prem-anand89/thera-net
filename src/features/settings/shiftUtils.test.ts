import { describe, expect, it } from 'vitest';
import {
  buildCoverage,
  calculateDailyCoverage,
  calculateWeeklyTotal,
  format12h,
  formatRange12h,
  formatShiftSummary,
  formatWeekdays,
  getTemplatePalette,
  previewAssign,
  sortWeekdays,
  templateUsage,
  validateShiftTemplate,
  clampBufferHours,
  formatCompactTime,
  formatCompactRange,
  formatDayRanges,
  describeSchedule,
} from './shiftUtils';
import type {
  Clinic,
  ShiftTemplate,
  Therapist,
  TherapistShiftAssignment,
} from '@/domain/types';

describe('shiftUtils', () => {
  describe('clampBufferHours', () => {
    it('clamps to range 0 to 12 as an integer', () => {
      expect(clampBufferHours(-3)).toBe(0);
      expect(clampBufferHours(15)).toBe(12);
      expect(clampBufferHours(0)).toBe(0);
      expect(clampBufferHours(12)).toBe(12);
      expect(clampBufferHours(3)).toBe(3);
      expect(clampBufferHours(3.4)).toBe(3);
      expect(clampBufferHours(3.8)).toBe(4);
    });

    it('falls back to 3 on NaN or non-finite', () => {
      expect(clampBufferHours(Number.NaN)).toBe(3);
      expect(clampBufferHours(Infinity)).toBe(3);
    });
  });

  describe('formatting & sorting', () => {
    it('formats 12h time strings correctly', () => {
      expect(format12h(540)).toBe('9:00 AM');
      expect(format12h(720)).toBe('12:00 PM');
      expect(format12h(780)).toBe('1:00 PM');
      expect(format12h(1020)).toBe('5:00 PM');
      expect(format12h(0)).toBe('12:00 AM');
      expect(formatRange12h(540, 1020)).toBe('9:00 AM – 5:00 PM');
    });

    it('sorts weekdays starting from Monday [1, 2, 3, 4, 5, 6, 0]', () => {
      expect(sortWeekdays([0, 5, 1, 3])).toEqual([1, 3, 5, 0]);
      expect(formatWeekdays([0, 5, 1, 3])).toBe('Mon/Wed/Fri/Sun');
    });

    it('returns deterministic template palette', () => {
      const p1 = getTemplatePalette('temp-1');
      const p2 = getTemplatePalette('temp-1');
      expect(p1).toEqual(p2);
      expect(p1.bg).toBeDefined();
    });
  });

  describe('formatShiftSummary & split shift recognition', () => {
    it('formats regular shift with break', () => {
      const template: ShiftTemplate = {
        id: 't1',
        clinicId: 'c1',
        name: 'General Shift',
        startMinute: 540,
        endMinute: 1020,
        breakDurationMinutes: 60,
        defaultBreakStartMinute: 780,
        active: true,
        updatedAt: '',
      };
      const res = formatShiftSummary(template);
      expect(res.isSplit).toBe(false);
      expect(res.summary).toBe('General Shift (9:00 AM – 5:00 PM, 1h break @ 1:00 PM)');
      expect(res.workingMinutes).toBe(420); // 8h - 1h = 7h
    });

    it('recognizes split shift when break is 120 minutes or longer', () => {
      const template: ShiftTemplate = {
        id: 't2',
        clinicId: 'c1',
        name: 'Split Shift',
        startMinute: 540, // 9:00 AM
        endMinute: 1200, // 8:00 PM
        breakDurationMinutes: 180, // 3h break
        defaultBreakStartMinute: 780, // 1:00 PM
        active: true,
        updatedAt: '',
      };
      const res = formatShiftSummary(template);
      expect(res.isSplit).toBe(true);
      expect(res.splitDetails).toContain('Morning: 9:00 AM – 1:00 PM & Evening: 4:00 PM – 8:00 PM (3h split)');
      expect(res.workingMinutes).toBe(480); // 11h - 3h = 8h
    });
  });

  describe('template validation', () => {
    it('validates empty name, reversed bounds, and excessive break', () => {
      expect(validateShiftTemplate('', 540, 1020, 60, null).valid).toBe(false);
      expect(validateShiftTemplate('Shift', 1020, 540, 60, null).valid).toBe(false);
      expect(validateShiftTemplate('Shift', 540, 600, 120, null).valid).toBe(false);
      expect(validateShiftTemplate('Shift', 540, 1020, 60, 500).valid).toBe(false); // break starts before shift
      expect(validateShiftTemplate('Shift', 540, 1020, 60, 1000).valid).toBe(false); // break ends after shift
      expect(validateShiftTemplate('Shift', 540, 1020, 60, 780).valid).toBe(true);
    });
  });

  describe('coverage matrix calculation', () => {
    const clinic: Pick<Clinic, 'bookingStartHour' | 'bookingEndHour' | 'closedWeekdays'> = {
      bookingStartHour: 9,
      bookingEndHour: 18,
      closedWeekdays: [0], // Sunday closed
    };

    const templates: ShiftTemplate[] = [
      {
        id: 'tmpl-morning',
        clinicId: 'c1',
        name: 'Morning Shift',
        startMinute: 540,
        endMinute: 840,
        breakDurationMinutes: 0,
        defaultBreakStartMinute: null,
        active: true,
        updatedAt: '',
      },
    ];

    const therapists: Therapist[] = [
      {
        id: 'th-1',
        clinicId: 'c1',
        name: 'Dr Prem',
        active: true,
        updatedAt: '',
      },
      {
        id: 'th-2',
        clinicId: 'c1',
        name: 'Dr Kiran',
        active: true,
        workingHours: {
          '1': [[540, 780]], // Mon custom: 9 to 13
          '2': [], // Tue off
        },
        updatedAt: '',
      },
    ];

    const assignments: TherapistShiftAssignment[] = [
      {
        id: 'a1',
        clinicId: 'c1',
        therapistId: 'th-1',
        shiftTemplateId: 'tmpl-morning',
        customHours: null,
        weekdays: [1, 3, 5], // Mon, Wed, Fri
        breakStartMinute: null,
        status: 'approved',
        note: null,
        decisionNote: null,
        requestedBy: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '',
        updatedAt: '',
      },
    ];

    it('builds weekly coverage cell accurately for templates, custom hours, and defaults', () => {
      const coverage = buildCoverage(therapists, assignments, templates, clinic);

      // Dr Prem Mon: Template
      const premMon = coverage.get('th-1')!.get(1)!;
      expect(premMon.type).toBe('template');
      expect(premMon.label).toBe('Morning Shift');
      expect(premMon.workingMinutes).toBe(300);

      // Dr Prem Tue: Clinic Default
      const premTue = coverage.get('th-1')!.get(2)!;
      expect(premTue.type).toBe('clinic_default');
      expect(premTue.workingMinutes).toBe(540); // 9h

      // Dr Kiran Wed: has stored hours that omit Wednesday → a day off, not clinic default
      const kiranWed = coverage.get('th-2')!.get(3)!;
      expect(kiranWed.type).toBe('off');
      expect(kiranWed.workingMinutes).toBe(0);

      // Dr Prem Sun: Clinic Closed
      const premSun = coverage.get('th-1')!.get(0)!;
      expect(premSun.type).toBe('clinic_closed');
      expect(premSun.workingMinutes).toBe(0);

      // Dr Kiran Mon: Custom
      const kiranMon = coverage.get('th-2')!.get(1)!;
      expect(kiranMon.type).toBe('custom');
      expect(kiranMon.label).toBe('9–1');
      expect(kiranMon.workingMinutes).toBe(240);

      // Dr Kiran Tue: Off
      const kiranTue = coverage.get('th-2')!.get(2)!;
      expect(kiranTue.type).toBe('off');
      expect(kiranTue.workingMinutes).toBe(0);
    });

    it('calculates weekly total hours correctly', () => {
      const coverage = buildCoverage(therapists, assignments, templates, clinic);

      const premTotal = calculateWeeklyTotal('th-1', coverage);
      // Mon (300) + Tue (540) + Wed (300) + Thu (540) + Fri (300) + Sat (540) + Sun (0) = 2520 mins = 42h
      expect(premTotal.totalHours).toBe(42);
      expect(premTotal.shiftsCount).toBe(6);
      expect(premTotal.isAllDefault).toBe(false);
    });

    it('calculates daily clinic coverage across therapists', () => {
      const coverage = buildCoverage(therapists, assignments, templates, clinic);

      // Monday: Dr Prem (Morning) + Dr Kiran (Custom) = 2 on duty
      const monCoverage = calculateDailyCoverage(1, coverage, false);
      expect(monCoverage.staffCount).toBe(2);
      expect(monCoverage.capacityHours).toBe(9); // 5h + 4h = 9h
      expect(monCoverage.label).toBe('2 on duty · 9h capacity');

      // Sunday: Clinic closed
      const sunCoverage = calculateDailyCoverage(0, coverage, true);
      expect(sunCoverage.staffCount).toBe(0);
      expect(sunCoverage.label).toBe('Clinic closed');
    });

    it('computes template usage accurately', () => {
      const usage = templateUsage('tmpl-morning', assignments);
      expect(usage).toEqual(['th-1']);
    });
  });

  describe('previewAssign', () => {
    it('generates clear impact and preview messages before assigning', () => {
      const therapist: Therapist = {
        id: 'th-1',
        clinicId: 'c1',
        name: 'Prem',
        active: true,
        workingHours: { '3': [[540, 780]] }, // Wed custom
        updatedAt: '',
      };
      const existingApproved: TherapistShiftAssignment[] = [
        {
          id: 'a1',
          clinicId: 'c1',
          therapistId: 'th-1',
          shiftTemplateId: 't-old',
          customHours: null,
          weekdays: [1, 2], // Mon, Tue
          breakStartMinute: null,
          status: 'approved',
          note: null,
          decisionNote: null,
          requestedBy: null,
          decidedBy: null,
          decidedAt: null,
          createdAt: '',
          updatedAt: '',
        },
      ];
      const template: ShiftTemplate = {
        id: 't-new',
        clinicId: 'c1',
        name: 'New Shift',
        startMinute: 540,
        endMinute: 1020,
        breakDurationMinutes: 60,
        defaultBreakStartMinute: 780,
        active: true,
        updatedAt: '',
      };

      const preview = previewAssign({
        therapists: [therapist],
        weekdays: [1, 3], // Mon (replaces t-old), Wed (supersedes custom)
        template,
        existingApproved,
        existingPending: [],
        clinic: { bookingStartHour: 9, bookingEndHour: 18 },
      });

      expect(preview.replaces).toContain("Replaces Mon on Prem's schedule");
      expect(preview.replaces).toContain('Supersedes custom hours for Wed on Prem');
      expect(preview.workingTime).toBe('Working time: 7h/day (8h − 1h break)');
    });
  });

  describe('compact formatting & day ranges', () => {
    it.each([
      [540, '9'],
      [510, '8:30'],
      [720, '12'],
      [780, '1'],
      [0, '12'],
    ])('formatCompactTime(%i) -> %s', (minute, expected) => {
      expect(formatCompactTime(minute)).toBe(expected);
    });

    it('formatCompactRange(start, end) formats with en dash', () => {
      expect(formatCompactRange(540, 1020)).toBe('9–5');
      expect(formatCompactRange(510, 810)).toBe('8:30–1:30');
    });

    it.each([
      [[1, 2, 3, 4, 5], 'Mon–Fri'],
      [[2, 6], 'Tue, Sat'],
      [[1, 2, 3, 5, 6], 'Mon–Wed, Fri–Sat'],
      [[1, 2], 'Mon, Tue'],
      [[0], 'Sun'],
      [[6, 0], 'Sat, Sun'],
    ])('formatDayRanges(%j) -> %s', (days, expected) => {
      expect(formatDayRanges(days)).toBe(expected);
    });
  });

  describe('describeSchedule', () => {
    const clinic: Pick<Clinic, 'bookingStartHour' | 'bookingEndHour' | 'closedWeekdays'> = {
      bookingStartHour: 9,
      bookingEndHour: 17,
      closedWeekdays: [0], // Sunday closed
    };

    const generalShift: ShiftTemplate = {
      id: 'tmpl-general',
      clinicId: 'c1',
      name: 'General Shift',
      startMinute: 540, // 9:00 AM
      endMinute: 960,   // 4:00 PM
      breakDurationMinutes: 60,
      defaultBreakStartMinute: 810, // 1:30 PM - 2:30 PM
      active: true,
      updatedAt: '',
    };

    it('Kiran-like (template General Shift, Mon–Sat 9–1:30 & 2:30–4)', () => {
      // 9:00 AM - 1:30 PM (540, 810), 2:30 PM - 4:00 PM (870, 960)
      const kiranHours: Record<string, [number, number][]> = {
        '1': [[540, 810], [870, 960]],
        '2': [[540, 810], [870, 960]],
        '3': [[540, 810], [870, 960]],
        '4': [[540, 810], [870, 960]],
        '5': [[540, 810], [870, 960]],
        '6': [[540, 810], [870, 960]],
      };
      const assignments: TherapistShiftAssignment[] = [
        {
          id: 'a1',
          clinicId: 'c1',
          therapistId: 'th-kiran',
          shiftTemplateId: 'tmpl-general',
          customHours: null,
          weekdays: [1, 2, 3, 4, 5, 6],
          breakStartMinute: 810,
          status: 'approved',
          note: null,
          decisionNote: null,
          requestedBy: null,
          decidedBy: null,
          decidedAt: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ];

      const desc = describeSchedule(
        { workingHours: kiranHours },
        assignments,
        [generalShift],
        clinic
      );

      expect(desc.type).toBe('template');
      expect(desc.headline).toBe('General Shift (Mon–Sat)');
      expect(desc.groups).toEqual([
        { days: [1, 2, 3, 4, 5, 6], label: '9–1:30 & 2:30–4' },
      ]);
      expect(desc.summary).toBe('Mon–Sat 9–1:30 & 2:30–4');
    });

    it('custom Tue/Sat -> Tue, Sat 10–1', () => {
      // 10:00 AM - 1:00 PM (600, 780)
      const customHours: Record<string, [number, number][]> = {
        '2': [[600, 780]],
        '6': [[600, 780]],
      };

      const desc = describeSchedule(
        { workingHours: customHours },
        [],
        [],
        clinic
      );

      expect(desc.type).toBe('custom');
      expect(desc.headline).toBe('Custom hours');
      expect(desc.groups).toEqual([
        { days: [2, 6], label: '10–1' },
      ]);
      expect(desc.summary).toBe('Tue, Sat 10–1');
    });

    it('three different groups -> summary ends +1 more', () => {
      const customHours: Record<string, [number, number][]> = {
        '1': [[540, 720]], // Mon 9-12
        '2': [[600, 780]], // Tue 10-1
        '3': [[720, 900]], // Wed 12-3
      };

      const desc = describeSchedule(
        { workingHours: customHours },
        [],
        [],
        clinic
      );

      expect(desc.type).toBe('custom');
      expect(desc.groups).toHaveLength(3);
      expect(desc.summary).toBe('Mon 9–12, Tue 10–1 +1 more');
    });

    it('null hours with Sunday closed -> clinic_default and groups Mon–Sat', () => {
      const desc = describeSchedule(
        { workingHours: null },
        [],
        [],
        clinic
      );

      expect(desc.type).toBe('clinic_default');
      expect(desc.headline).toBe('Clinic default hours');
      expect(desc.groups).toEqual([
        { days: [1, 2, 3, 4, 5, 6], label: '9–5' },
      ]);
      expect(desc.summary).toBe('Mon–Sat 9–5');
    });

    it('empty {} hours -> off / No working days', () => {
      const desc = describeSchedule(
        { workingHours: {} },
        [],
        [],
        clinic
      );

      expect(desc.type).toBe('off');
      expect(desc.headline).toBe('No working days');
      expect(desc.groups).toEqual([]);
      expect(desc.summary).toBe('No working days');
    });

    it('declined/pending/superseded rows are ignored for template determination', () => {
      const assignments: TherapistShiftAssignment[] = [
        {
          id: 'a-declined',
          clinicId: 'c1',
          therapistId: 'th-1',
          shiftTemplateId: 'tmpl-general',
          customHours: null,
          weekdays: [1, 2, 3, 4, 5],
          breakStartMinute: null,
          status: 'declined',
          note: null,
          decisionNote: null,
          requestedBy: null,
          decidedBy: null,
          decidedAt: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'a-pending',
          clinicId: 'c1',
          therapistId: 'th-1',
          shiftTemplateId: 'tmpl-general',
          customHours: null,
          weekdays: [1, 2, 3, 4, 5],
          breakStartMinute: null,
          status: 'pending',
          note: null,
          decisionNote: null,
          requestedBy: null,
          decidedBy: null,
          decidedAt: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ];

      const desc = describeSchedule(
        { workingHours: null },
        assignments,
        [generalShift],
        clinic
      );

      expect(desc.type).toBe('clinic_default');
      expect(desc.headline).toBe('Clinic default hours');
    });
  });
});

