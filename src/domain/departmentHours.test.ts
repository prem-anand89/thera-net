import { describe, expect, it } from 'vitest';
import { closedDateAppliesTo, departmentHours, isDepartmentClosedOn } from './departmentHours';

const base = {
  bookingStartHour: 9,
  bookingEndHour: 17,
  operatingHours: null,
  closedWeekdays: [0],
  slotDurationMinutes: 30,
  startStepMinutes: 15,
  departmentHours: null,
};

describe('departmentHours', () => {
  it('OP is the clinic columns', () => {
    expect(departmentHours(base, 'clinic')).toEqual({
      clinicHours: { startHour: 9, endHour: 17, operating: null },
      slotMinutes: 30,
      startStepMinutes: 15,
      closedWeekdays: [0],
    });
  });

  it('Home care and IP follow OP when nothing is set', () => {
    expect(departmentHours(base, 'home')).toEqual(departmentHours(base, 'clinic'));
    expect(departmentHours(base, 'ward')).toEqual(departmentHours(base, 'clinic'));
  });

  it('a partial override changes only what it sets, and OP is untouched', () => {
    const clinic = { ...base, departmentHours: { home: { startHour: 6, endHour: 20, slotMinutes: 60 } } };
    const home = departmentHours(clinic, 'home');
    expect(home.clinicHours).toEqual({ startHour: 6, endHour: 20, operating: null });
    expect(home.slotMinutes).toBe(60);
    expect(home.startStepMinutes).toBe(60);
    expect(home.closedWeekdays).toEqual([0]);
    expect(departmentHours(clinic, 'clinic').slotMinutes).toBe(30);
    expect(departmentHours(clinic, 'ward')).toEqual(departmentHours(base, 'clinic'));
  });

  it("OP's lunch break does not carry into a department that set its own window, but does when it set none", () => {
    const lunch = { 1: [[540, 780], [900, 1020]] } as never;
    const clinic = {
      ...base,
      operatingHours: lunch,
      departmentHours: { home: { startHour: 6, endHour: 12 }, ward: { slotMinutes: 20 } },
    };
    expect(departmentHours(clinic, 'home').clinicHours.operating).toBeNull();
    expect(departmentHours(clinic, 'ward').clinicHours.operating).toBe(lunch);
  });

  it('ignores an impossible window and out-of-range slot length', () => {
    const clinic = { ...base, departmentHours: { ward: { startHour: 20, endHour: 6, slotMinutes: 1 } } };
    const ward = departmentHours(clinic, 'ward');
    expect(ward.clinicHours).toEqual({ startHour: 9, endHour: 17, operating: null });
    expect(ward.slotMinutes).toBe(30);
  });

  it('own closed weekdays replace OP (IP open every day)', () => {
    const clinic = { ...base, departmentHours: { ward: { closedWeekdays: [] } } };
    expect(departmentHours(clinic, 'ward').closedWeekdays).toEqual([]);
    expect(departmentHours(clinic, 'clinic').closedWeekdays).toEqual([0]);
  });
});

describe('closed dates by department', () => {
  const sunday = '2026-11-08';
  const holiday = '2026-11-10';
  it('a holiday with no departments closes everyone', () => {
    expect(closedDateAppliesTo({ departments: null }, 'ward')).toBe(true);
    expect(closedDateAppliesTo({}, 'home')).toBe(true);
  });
  it('a holiday for OP only leaves Home care and IP open', () => {
    const closed = [{ closedDate: holiday, departments: ['clinic' as const] }];
    expect(isDepartmentClosedOn(base, 'clinic', holiday, closed)).toBe(true);
    expect(isDepartmentClosedOn(base, 'home', holiday, closed)).toBe(false);
    expect(isDepartmentClosedOn(base, 'ward', holiday, closed)).toBe(false);
  });
  it('closed weekdays are per department', () => {
    const clinic = { ...base, departmentHours: { ward: { closedWeekdays: [] } } };
    expect(isDepartmentClosedOn(clinic, 'clinic', sunday, [])).toBe(true);
    expect(isDepartmentClosedOn(clinic, 'ward', sunday, [])).toBe(false);
  });
});
