import { describe, expect, it } from 'vitest';
import {
  completedStepsKey,
  firstWeekChecklistDismissedKey,
  lastBackupMetaKey,
} from './FirstWeekChecklist';

/**
 * These three key builders are the only thing standing between one
 * clinic's checklist state and another's on a device with multiple
 * clinics — `db.meta` is one global table, so a collision here means
 * dismissing/completing/backing-up for clinic A silently does the same
 * for clinic B. Exercised directly rather than through the hooks that
 * call them, matching this repo's existing convention of testing pure
 * logic rather than rendering components.
 */
describe('FirstWeekChecklist clinic-scoped meta keys', () => {
  it('differ for different clinics', () => {
    expect(firstWeekChecklistDismissedKey('clinic-a')).not.toBe(
      firstWeekChecklistDismissedKey('clinic-b')
    );
    expect(completedStepsKey('clinic-a')).not.toBe(completedStepsKey('clinic-b'));
    expect(lastBackupMetaKey('clinic-a')).not.toBe(lastBackupMetaKey('clinic-b'));
  });

  it('are stable for the same clinic', () => {
    expect(firstWeekChecklistDismissedKey('clinic-a')).toBe(
      firstWeekChecklistDismissedKey('clinic-a')
    );
    expect(completedStepsKey('clinic-a')).toBe(completedStepsKey('clinic-a'));
  });

  it('never collide with each other for the same clinic', () => {
    const keys = [
      firstWeekChecklistDismissedKey('clinic-a'),
      completedStepsKey('clinic-a'),
      lastBackupMetaKey('clinic-a'),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
