import { describe, expect, it } from 'vitest';
import { canSwitchDepartment, departmentOf, inDepartment, resolveDepartment, therapistsInDepartment, visibleDepartments } from './departments';

const all = { careLocations: ['clinic', 'home', 'ward'] };

describe('visibleDepartments', () => {
  it('an admin sees every department the clinic has, whatever is assigned', () => {
    expect(visibleDepartments(all, { role: 'admin', departments: ['home'] })).toEqual(['clinic', 'home', 'ward']);
  });

  it('anyone else sees what is assigned, in fixed order; none assigned means all', () => {
    expect(visibleDepartments(all, { role: 'therapist', departments: ['ward', 'clinic'] })).toEqual(['clinic', 'ward']);
    expect(visibleDepartments(all, { role: 'front_desk', departments: null })).toEqual(['clinic', 'home', 'ward']);
    expect(visibleDepartments(all, { role: 'therapist', departments: [] })).toEqual(['clinic', 'home', 'ward']);
  });

  it('is limited to what the clinic has, and falls back to all when nothing assigned is left', () => {
    expect(visibleDepartments({ careLocations: ['clinic', 'home'] }, { role: 'therapist', departments: ['ward', 'home'] })).toEqual(['home']);
    expect(visibleDepartments({ careLocations: ['clinic', 'home'] }, { role: 'therapist', departments: ['ward'] })).toEqual(['clinic', 'home']);
  });

  it('a clinic with one place has one department, so no switch', () => {
    const v = visibleDepartments({ careLocations: ['clinic'] }, { role: 'admin' });
    expect(v).toEqual(['clinic']);
    expect(canSwitchDepartment(v)).toBe(false);
    expect(canSwitchDepartment(['clinic', 'ward'])).toBe(true);
  });
});

describe('resolveDepartment', () => {
  it('keeps the remembered department while it is still allowed, else the first allowed', () => {
    expect(resolveDepartment(['clinic', 'ward'], 'ward')).toBe('ward');
    expect(resolveDepartment(['clinic', 'ward'], 'home')).toBe('clinic');
    expect(resolveDepartment(['home'], null)).toBe('home');
    expect(resolveDepartment([], 'ward')).toBe('clinic');
  });
});

describe('records and roster', () => {
  it('a record with no place is OP; a ward record is IP', () => {
    expect(departmentOf({})).toBe('clinic');
    expect(departmentOf({ location: null })).toBe('clinic');
    expect(inDepartment('ward', { location: 'ward' })).toBe(true);
    expect(inDepartment('clinic', { location: 'home' })).toBe(false);
  });

  it('the roster offers everyone with no restriction and only those who work in the department otherwise', () => {
    const people = [{ id: 'a' }, { id: 'b', careLocations: ['home'] }, { id: 'c', careLocations: ['clinic', 'ward'] }, { id: 'd', careLocations: [] }];
    expect(therapistsInDepartment('clinic', people).map((p) => p.id)).toEqual(['a', 'c', 'd']);
    expect(therapistsInDepartment('home', people).map((p) => p.id)).toEqual(['a', 'b', 'd']);
  });
});
