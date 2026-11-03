import { describe, expect, it } from 'vitest';
import { assertNameFree, firstDuplicateName, groupNameCheck, nameCheck, nameCheckBlocks, NameTakenError } from './nameCheck';

const items = [
  { id: 'a', name: 'Initial Assessment', active: true },
  { id: 'b', name: 'Follow-up consultation', active: true },
  { id: 'c', name: 'Electro Therapy', active: true },
  { id: 'd', name: 'Dry Needling', active: false },
];

describe('nameCheck', () => {
  it('blocks the same name as an offered item, ignoring capitals and spaces', () => {
    expect(nameCheck('Initial Assessment', items)).toEqual({ kind: 'exact', match: items[0] });
    expect(nameCheck('  initial assessment ', items).kind).toBe('exact');
    expect(nameCheckBlocks(nameCheck('INITIAL ASSESSMENT', items))).toBe(true);
  });

  it('blocks the name of a hidden item and names it, so the screen can offer it again', () => {
    const r = nameCheck('dry needling', items);
    expect(r).toEqual({ kind: 'hidden', match: items[3] });
    expect(nameCheckBlocks(r)).toBe(true);
  });

  it('only prompts for a near match: plural, hyphen, spaces', () => {
    expect(nameCheck('Initial Assessments', items)).toEqual({ kind: 'similar', match: items[0] });
    expect(nameCheck('Follow up consultation', items).kind).toBe('similar');
    expect(nameCheck('Electro-therapy', items).kind).toBe('similar');
    expect(nameCheckBlocks(nameCheck('Electro-therapy', items))).toBe(false);
  });

  it('gives no hit for different words, an empty name, or an abbreviation', () => {
    expect(nameCheck('Home visit', items).kind).toBe('none');
    expect(nameCheck('   ', items).kind).toBe('none');
    expect(nameCheck('ET', items).kind).toBe('none');
  });

  it('never compares an item with itself, and its own unchanged name passes', () => {
    expect(nameCheck('Initial Assessment', items, { selfId: 'a' }).kind).toBe('none');
    expect(nameCheck('initial assessment', items, { selfId: 'a' }).kind).toBe('none');
    expect(nameCheck('Dry Needling', items, { selfId: 'a' }).kind).toBe('hidden');
  });

  it('lets a clinic that already has a case-only pair keep editing both under their own names', () => {
    const pair = [
      { id: 'x', name: 'Taping', active: true },
      { id: 'y', name: 'taping', active: true },
    ];
    expect(nameCheck('Taping', pair, { selfId: 'x' }).kind).toBe('none');
    expect(nameCheck('taping', pair, { selfId: 'y' }).kind).toBe('none');
    // Renaming either one to something else that clashes is still caught.
    expect(nameCheck('TAPING', pair, { selfId: 'x' }).kind).toBe('exact');
  });
});

describe('groupNameCheck', () => {
  const groups = ['Consultation', 'Physiotherapy'];
  it('an existing group (capitals ignored) is "exact" and gives its spelling; a near one is "similar"', () => {
    expect(groupNameCheck('consultation', groups)).toEqual({ kind: 'exact', match: 'Consultation' });
    expect(groupNameCheck('Consultations', groups)).toEqual({ kind: 'similar', match: 'Consultation' });
    expect(groupNameCheck('Assessment', groups)).toEqual({ kind: 'none', match: null });
  });

  it('the group being renamed is not a match for itself', () => {
    expect(groupNameCheck('Consultation', groups, 'Consultation').kind).toBe('none');
    expect(groupNameCheck('physiotherapy', groups, 'Consultation')).toEqual({ kind: 'exact', match: 'Physiotherapy' });
  });
});

describe('assertNameFree and firstDuplicateName', () => {
  it('throws a person-readable NameTakenError for a taken name', () => {
    expect(() => assertNameFree('initial assessment', items)).toThrow(NameTakenError);
    expect(() => assertNameFree('initial assessment', items)).toThrow('You already have Initial Assessment.');
    expect(() => assertNameFree('Dry needling', items, { hiddenLabel: 'is in No longer offered' })).toThrow(
      'Dry Needling is in No longer offered.'
    );
    expect(assertNameFree('Electro-therapy', items).kind).toBe('similar');
  });

  it('finds a name listed twice in a batch, capitals ignored', () => {
    expect(firstDuplicateName(['Session', 'Package', 'session '])).toBe('session');
    expect(firstDuplicateName(['Session', 'Package', ''])).toBeNull();
  });
});
