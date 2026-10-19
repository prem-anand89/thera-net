// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  readStoredPhoneView,
  writeStoredPhoneView,
  threeDayDates,
  formatThreeDayTitle,
  stepThreeDay,
  isDateInThreeDayWindow,
  phonePxPerMinute,
  densityFor,
  selectedTherapistIds,
  canManageAppointment,
  isColleagueAppointment,
  toggleTherapistSelection,
  nextTherapistSearchParam,
  historyAppointments,
  PHONE_VIEW_STORAGE_KEY,
} from './schedulePhoneHelpers';

describe('schedulePhoneHelpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('readStoredPhoneView / writeStoredPhoneView', () => {
    it('defaults to "day" when no value is stored', () => {
      expect(readStoredPhoneView()).toBe('day');
    });

    it('reads valid stored values', () => {
      writeStoredPhoneView('list');
      expect(readStoredPhoneView()).toBe('list');

      writeStoredPhoneView('3day');
      expect(readStoredPhoneView()).toBe('3day');

      writeStoredPhoneView('day');
      expect(readStoredPhoneView()).toBe('day');
    });

    it('falls back to "day" when stored value is invalid', () => {
      localStorage.setItem(PHONE_VIEW_STORAGE_KEY, 'invalid');
      expect(readStoredPhoneView()).toBe('day');
    });

    it('safely handles localStorage throwing', () => {
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = () => {
        throw new Error('Access denied');
      };
      expect(readStoredPhoneView()).toBe('day');
      localStorage.getItem = originalGetItem;

      const originalSetItem = localStorage.setItem;
      localStorage.setItem = () => {
        throw new Error('Quota exceeded');
      };
      expect(() => writeStoredPhoneView('3day')).not.toThrow();
      localStorage.setItem = originalSetItem;
    });
  });

  describe('threeDayDates', () => {
    it('returns three consecutive ISO date strings', () => {
      expect(threeDayDates('2026-10-19')).toEqual([
        '2026-10-19',
        '2026-10-20',
        '2026-10-21',
      ]);
    });

    it('handles month boundaries correctly', () => {
      expect(threeDayDates('2026-10-31')).toEqual([
        '2026-10-31',
        '2026-11-01',
        '2026-11-02',
      ]);
    });

    it('handles year boundaries correctly', () => {
      expect(threeDayDates('2026-12-31')).toEqual([
        '2026-12-31',
        '2027-01-01',
        '2027-01-02',
      ]);
    });
  });

  describe('formatThreeDayTitle', () => {
    it('formats a date range within the same month', () => {
      expect(formatThreeDayTitle('2026-10-19')).toBe('19 – 21 Oct 2026');
    });

    it('formats a date range spanning months', () => {
      expect(formatThreeDayTitle('2026-10-30')).toBe('30 Oct – 1 Nov 2026');
    });

    it('formats a date range spanning years', () => {
      expect(formatThreeDayTitle('2026-12-31')).toBe('31 Dec 2026 – 2 Jan 2027');
    });
  });

  describe('stepThreeDay', () => {
    it('steps forward by 3 days', () => {
      expect(stepThreeDay('2026-10-19', 1)).toBe('2026-10-22');
    });

    it('steps backward by 3 days', () => {
      expect(stepThreeDay('2026-10-19', -1)).toBe('2026-10-16');
    });
  });

  describe('isDateInThreeDayWindow', () => {
    it('returns true when date is in the 3-day window', () => {
      expect(isDateInThreeDayWindow('2026-10-19', '2026-10-19')).toBe(true);
      expect(isDateInThreeDayWindow('2026-10-20', '2026-10-19')).toBe(true);
      expect(isDateInThreeDayWindow('2026-10-21', '2026-10-19')).toBe(true);
    });

    it('returns false when date is outside the 3-day window', () => {
      expect(isDateInThreeDayWindow('2026-10-18', '2026-10-19')).toBe(false);
      expect(isDateInThreeDayWindow('2026-10-22', '2026-10-19')).toBe(false);
    });
  });

  describe('phonePxPerMinute', () => {
    it('ensures 15-minute slot is at least 44px tall', () => {
      const ppm = phonePxPerMinute(15);
      expect(ppm * 15).toBeGreaterThanOrEqual(44);
      expect(ppm).toBeCloseTo(44 / 15, 2);
    });

    it('uses standard 1.6 px/min for 30m slot (48px tall >= 44px)', () => {
      const ppm = phonePxPerMinute(30);
      expect(ppm).toBe(1.6);
      expect(ppm * 30).toBe(48);
    });

    it('uses standard 1.6 px/min for 60m slot (96px tall >= 44px)', () => {
      const ppm = phonePxPerMinute(60);
      expect(ppm).toBe(1.6);
      expect(ppm * 60).toBe(96);
    });
  });

  describe('densityFor', () => {
    it('returns "full" for widths >= 150px and adequate height', () => {
      expect(densityFor(160, 60)).toBe('full');
      expect(densityFor(150, 48)).toBe('full');
    });

    it('returns "medium" for widths 110px to 149px and adequate height', () => {
      expect(densityFor(140, 60)).toBe('medium');
      expect(densityFor(110, 40)).toBe('medium');
    });

    it('returns "compact" for widths < 110px', () => {
      expect(densityFor(100, 60)).toBe('compact');
      expect(densityFor(98, 48)).toBe('compact');
    });

    it('forces "compact" for short blocks (< 34px) regardless of width', () => {
      expect(densityFor(200, 30)).toBe('compact');
      expect(densityFor(120, 24)).toBe('compact');
    });
  });

  describe('selectedTherapistIds', () => {
    const roster = ['th-1', 'th-2', 'th-3'];

    describe('when role is therapist', () => {
      it('defaults to [myTherapistId] when search is empty', () => {
        expect(selectedTherapistIds('therapist', 'th-1', undefined, roster)).toEqual(['th-1']);
        expect(selectedTherapistIds('therapist', 'th-1', '', roster)).toEqual(['th-1']);
      });

      it('filters colleagues from search and preserves own ID', () => {
        // Therapist adds colleague th-2
        expect(selectedTherapistIds('therapist', 'th-1', 'th-2', roster)).toEqual(['th-1', 'th-2']);
        // When search contains own ID and colleague
        expect(selectedTherapistIds('therapist', 'th-1', 'th-1,th-3', roster)).toEqual(['th-1', 'th-3']);
      });

      it('ignores unknown IDs not in roster', () => {
        expect(selectedTherapistIds('therapist', 'th-1', 'th-2,unknown-id', roster)).toEqual(['th-1', 'th-2']);
      });
    });

    describe('when role is admin or other', () => {
      it('returns [] when search is empty (signifying all therapists)', () => {
        expect(selectedTherapistIds('admin', null, undefined, roster)).toEqual([]);
        expect(selectedTherapistIds('front_desk', 'th-1', '', roster)).toEqual([]);
      });

      it('filters search string by roster', () => {
        expect(selectedTherapistIds('admin', null, 'th-2,th-3,unknown', roster)).toEqual(['th-2', 'th-3']);
      });
    });
  });

  describe('canManageAppointment', () => {
    it('allows management if clinic-wide view (admin/front desk)', () => {
      expect(canManageAppointment({ therapistId: 'th-2' }, 'th-1', true)).toBe(true);
    });

    it('allows management if appointment belongs to own therapist ID', () => {
      expect(canManageAppointment({ therapistId: 'th-1' }, 'th-1', false)).toBe(true);
    });

    it('forbids management if appointment belongs to a colleague', () => {
      expect(canManageAppointment({ therapistId: 'th-2' }, 'th-1', false)).toBe(false);
    });
  });

  describe('isColleagueAppointment', () => {
    it('returns true when a therapist views another therapist appointment', () => {
      expect(isColleagueAppointment({ therapistId: 'th-2' }, 'therapist', 'th-1')).toBe(true);
    });

    it('returns false for own appointment', () => {
      expect(isColleagueAppointment({ therapistId: 'th-1' }, 'therapist', 'th-1')).toBe(false);
    });

    it('returns false for admin or non-therapist role', () => {
      expect(isColleagueAppointment({ therapistId: 'th-2' }, 'admin', 'th-1')).toBe(false);
    });

    it('returns false for unassigned appointment', () => {
      expect(isColleagueAppointment({ therapistId: null }, 'therapist', 'th-1')).toBe(false);
    });
  });

  describe('toggleTherapistSelection', () => {
    const roster = ['th-1', 'th-2', 'th-3'];

    describe('when role is therapist', () => {
      it('cannot remove own column (unticking own ID is a no-op)', () => {
        expect(toggleTherapistSelection('th-1', ['th-1', 'th-2'], roster, 'therapist', 'th-1')).toEqual(['th-1', 'th-2']);
        expect(toggleTherapistSelection('th-1', ['th-1'], roster, 'therapist', 'th-1')).toEqual(['th-1']);
        expect(toggleTherapistSelection('th-1', [], roster, 'therapist', 'th-1')).toEqual(['th-1']);
      });

      it('toggles colleague and preserves own ID', () => {
        // Ticking colleague th-2 from base of own column
        expect(toggleTherapistSelection('th-2', ['th-1'], roster, 'therapist', 'th-1')).toEqual(['th-1', 'th-2']);
        // Unticking colleague th-2
        expect(toggleTherapistSelection('th-2', ['th-1', 'th-2'], roster, 'therapist', 'th-1')).toEqual(['th-1']);
      });

      it('ticking all colleagues keeps own column and all colleagues', () => {
        const withTwo = toggleTherapistSelection('th-2', ['th-1'], roster, 'therapist', 'th-1');
        const withAll = toggleTherapistSelection('th-3', withTwo, roster, 'therapist', 'th-1');
        expect(withAll).toEqual(['th-1', 'th-2', 'th-3']);
      });
    });

    describe('when role is admin or other', () => {
      it('unticking one from empty (all) leaves the remaining therapists', () => {
        expect(toggleTherapistSelection('th-2', [], roster, 'admin', null)).toEqual(['th-1', 'th-3']);
      });

      it('ticking missing therapist returns full list', () => {
        expect(toggleTherapistSelection('th-2', ['th-1', 'th-3'], roster, 'admin', null)).toEqual(['th-1', 'th-3', 'th-2']);
      });
    });
  });

  describe('nextTherapistSearchParam', () => {
    const roster = ['th-1', 'th-2', 'th-3'];

    describe('when role is therapist', () => {
      it('returns undefined when only own column is selected (clean URL default)', () => {
        expect(nextTherapistSearchParam(['th-1'], roster, 'therapist', 'th-1')).toBeUndefined();
        expect(nextTherapistSearchParam([], roster, 'therapist', 'th-1')).toBeUndefined();
      });

      it('returns explicit comma-separated IDs when colleagues are selected', () => {
        expect(nextTherapistSearchParam(['th-1', 'th-2'], roster, 'therapist', 'th-1')).toBe('th-1,th-2');
      });

      it('crucial: keeps explicit list when ALL colleagues are selected (never collapses to undefined)', () => {
        expect(nextTherapistSearchParam(['th-1', 'th-2', 'th-3'], roster, 'therapist', 'th-1')).toBe('th-1,th-2,th-3');
      });

      it('ensures own column is included even if omitted in input', () => {
        expect(nextTherapistSearchParam(['th-2', 'th-3'], roster, 'therapist', 'th-1')).toBe('th-1,th-2,th-3');
      });
    });

    describe('when role is admin or other', () => {
      it('returns undefined when all or no therapists are selected', () => {
        expect(nextTherapistSearchParam([], roster, 'admin', null)).toBeUndefined();
        expect(nextTherapistSearchParam(['th-1', 'th-2', 'th-3'], roster, 'admin', null)).toBeUndefined();
      });

      it('returns comma-separated string for a subset', () => {
        expect(nextTherapistSearchParam(['th-1', 'th-3'], roster, 'admin', null)).toBe('th-1,th-3');
      });
    });
  });

  describe('historyAppointments', () => {
    const list = [
      { id: 'a1', therapistId: 'th-1' },
      { id: 'a2', therapistId: 'th-2' },
      { id: 'a3', therapistId: 'th-1' },
      { id: 'a4', therapistId: 'th-3' },
    ];

    it('for therapist role: filters strictly to own appointments', () => {
      expect(historyAppointments(list, 'therapist', 'th-1')).toEqual([
        { id: 'a1', therapistId: 'th-1' },
        { id: 'a3', therapistId: 'th-1' },
      ]);
    });

    it('for therapist role without myTherapistId: returns empty array (fail-closed)', () => {
      expect(historyAppointments(list, 'therapist', null)).toEqual([]);
    });

    it('for admin/front-desk role: returns all appointments', () => {
      expect(historyAppointments(list, 'admin', null)).toEqual(list);
      expect(historyAppointments(list, 'front_desk', 'th-1')).toEqual(list);
    });
  });
});
