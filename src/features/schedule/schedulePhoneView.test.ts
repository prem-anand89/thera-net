// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE_PHONE_VIEW,
  SCHEDULE_PHONE_VIEW_KEY,
  formatThreeDayRange,
  getPhoneStepAmount,
  getThreeDayDates,
  isPhoneTodayVisible,
  readStoredPhoneView,
  writeStoredPhoneView,
} from './schedulePhoneView';

describe('schedulePhoneView', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('localStorage persistence', () => {
    it('defaults to day view when nothing is stored', () => {
      expect(readStoredPhoneView()).toBe(DEFAULT_SCHEDULE_PHONE_VIEW);
      expect(DEFAULT_SCHEDULE_PHONE_VIEW).toBe('day');
    });

    it('persists and restores phone views (day, 3day, list)', () => {
      writeStoredPhoneView('3day');
      expect(readStoredPhoneView()).toBe('3day');
      expect(localStorage.getItem(SCHEDULE_PHONE_VIEW_KEY)).toBe('3day');

      writeStoredPhoneView('list');
      expect(readStoredPhoneView()).toBe('list');

      writeStoredPhoneView('day');
      expect(readStoredPhoneView()).toBe('day');
    });

    it('falls back to default if storage contains invalid value', () => {
      localStorage.setItem(SCHEDULE_PHONE_VIEW_KEY, 'invalid_mode');
      expect(readStoredPhoneView()).toBe('day');
    });
  });

  describe('getThreeDayDates', () => {
    it('returns consecutive 3 dates starting from given date', () => {
      expect(getThreeDayDates('2026-10-18')).toEqual([
        '2026-10-18',
        '2026-10-19',
        '2026-10-20',
      ]);
    });

    it('crosses month boundary correctly', () => {
      expect(getThreeDayDates('2026-10-31')).toEqual([
        '2026-10-31',
        '2026-11-01',
        '2026-11-02',
      ]);
    });
  });

  describe('getPhoneStepAmount', () => {
    it('steps 1 day forward/backward for day and list views', () => {
      expect(getPhoneStepAmount('day', 1)).toBe(1);
      expect(getPhoneStepAmount('day', -1)).toBe(-1);
      expect(getPhoneStepAmount('list', 1)).toBe(1);
      expect(getPhoneStepAmount('list', -1)).toBe(-1);
    });

    it('steps 3 days forward/backward for 3day view', () => {
      expect(getPhoneStepAmount('3day', 1)).toBe(3);
      expect(getPhoneStepAmount('3day', -1)).toBe(-3);
    });
  });

  describe('isPhoneTodayVisible', () => {
    it('matches exact day for day and list views', () => {
      expect(isPhoneTodayVisible('day', '2026-10-18', '2026-10-18')).toBe(true);
      expect(isPhoneTodayVisible('day', '2026-10-18', '2026-10-19')).toBe(false);
      expect(isPhoneTodayVisible('list', '2026-10-18', '2026-10-18')).toBe(true);
      expect(isPhoneTodayVisible('list', '2026-10-18', '2026-10-19')).toBe(false);
    });

    it('returns true if today is any of the 3 days in 3day view', () => {
      expect(isPhoneTodayVisible('3day', '2026-10-18', '2026-10-18')).toBe(true);
      expect(isPhoneTodayVisible('3day', '2026-10-18', '2026-10-19')).toBe(true);
      expect(isPhoneTodayVisible('3day', '2026-10-18', '2026-10-20')).toBe(true);
      expect(isPhoneTodayVisible('3day', '2026-10-18', '2026-10-21')).toBe(false);
      expect(isPhoneTodayVisible('3day', '2026-10-18', '2026-10-17')).toBe(false);
    });
  });

  describe('formatThreeDayRange', () => {
    it('formats dates in the same month cleanly', () => {
      expect(formatThreeDayRange('2026-10-18')).toBe('18 – 20 Oct');
    });

    it('formats dates across different months cleanly', () => {
      expect(formatThreeDayRange('2026-10-30')).toBe('30 Oct – 1 Nov');
    });
  });
});
