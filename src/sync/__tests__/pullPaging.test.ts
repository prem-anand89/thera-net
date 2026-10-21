import { describe, expect, it } from 'vitest';
import { afterKeyFilter, membershipKey, pullStartFrom, PULL_OVERLAP_MS, rowsToDelete } from '../engine';

describe('pullStartFrom', () => {
  it('starts a short overlap before the saved cursor', () => {
    const start = pullStartFrom('2026-10-22T10:00:00.123456+00:00');
    expect(Date.parse('2026-10-22T10:00:00.123Z') - Date.parse(start)).toBe(PULL_OVERLAP_MS);
  });

  it('never goes before the epoch, and treats a broken cursor as the epoch', () => {
    expect(pullStartFrom('1970-01-01T00:00:00+00:00')).toBe('1970-01-01T00:00:00.000Z');
    expect(pullStartFrom('not a date')).toBe('1970-01-01T00:00:00+00:00');
  });
});

describe('afterKeyFilter', () => {
  it('asks for later timestamps, or the same timestamp with a later id', () => {
    expect(afterKeyFilter('2026-10-22T10:00:00.5+00:00', 'b2')).toBe(
      'updated_at.gt."2026-10-22T10:00:00.5+00:00",and(updated_at.eq."2026-10-22T10:00:00.5+00:00",id.gt.b2)'
    );
  });
});

describe('membershipKey', () => {
  it('differs when only the role changes, so a role change re-pulls', () => {
    expect(membershipKey('c1', 'front_desk')).not.toBe(membershipKey('c1', 'therapist'));
  });
});

describe('rowsToDelete', () => {
  const deletedAt = '2026-10-22T10:00:00+00:00';
  const local = new Map([
    ['patients:p1', '2026-10-22T09:00:00+00:00'],
    ['patients:p2', '2026-10-22T11:00:00+00:00'],
    ['visits:v1', '2026-10-22T09:00:00+00:00'],
  ]);
  const lookup = (table: string, id: string) => local.get(`${table}:${id}`);

  it('deletes a local row older than its tombstone', () => {
    expect(rowsToDelete([{ table: 'patients', rowId: 'p1', deletedAt }], new Set(), lookup)).toEqual([
      { table: 'patients', rowId: 'p1' },
    ]);
  });

  it('keeps a row changed after the delete, one with a pending edit, one not on the device, and unknown tables', () => {
    expect(
      rowsToDelete(
        [
          { table: 'patients', rowId: 'p2', deletedAt },
          { table: 'visits', rowId: 'v1', deletedAt },
          { table: 'patients', rowId: 'missing', deletedAt },
          { table: 'audit_log', rowId: 'x', deletedAt },
        ],
        new Set(['visits:v1']),
        lookup
      )
    ).toEqual([]);
  });
});
