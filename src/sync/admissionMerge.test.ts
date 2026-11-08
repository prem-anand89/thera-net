import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { mergeDuplicateAdmission } from './admissionMerge';
import type { Admission, Visit } from '@/domain/types';

const stay = (id: string, over: Partial<Admission> = {}): Admission => ({
  id, clinicId: 'c', patientId: 'p', ipdNo: null, wardBed: null, admittingDoctor: null,
  admittedOn: '2026-11-01', dischargedOn: null, notes: null, deleted: false, updatedAt: 't', ...over,
});
const visit = (id: string, admissionId: string | null) =>
  ({ id, clinicId: 'c', patientId: 'p', admissionId, updatedAt: 't', deleted: false }) as unknown as Visit;

describe('mergeDuplicateAdmission', () => {
  beforeEach(async () => {
    await db.admissions.clear();
    await db.visits.clear();
    await db.outbox.clear();
  });

  it('moves the losing stay\'s visits onto the surviving stay, queues them, and drops the losing stay and its pushes', async () => {
    await db.admissions.put(stay('lose'));
    await db.visits.bulkPut([visit('v1', 'lose'), visit('v2', 'lose'), visit('v3', null)]);
    await db.outbox.add({ table: 'admissions', rowId: 'lose', ts: 1 });

    const moved = await mergeDuplicateAdmission(stay('lose'), stay('win', { wardBed: 'Ward A' }));

    expect(moved).toBe(2);
    expect((await db.visits.get('v1'))?.admissionId).toBe('win');
    expect((await db.visits.get('v2'))?.admissionId).toBe('win');
    expect((await db.visits.get('v3'))?.admissionId).toBeNull();
    expect(await db.admissions.get('lose')).toBeUndefined();
    expect((await db.admissions.get('win'))?.wardBed).toBe('Ward A');
    const queued = await db.outbox.toArray();
    expect(queued.filter((e) => e.table === 'visits').map((e) => e.rowId).sort()).toEqual(['v1', 'v2']);
    expect(queued.some((e) => e.table === 'admissions')).toBe(false);
  });
});
