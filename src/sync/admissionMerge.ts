import { db } from '@/lib/db';
import { repointVisits } from '@/domain/admissions';
import type { Admission } from '@/domain/types';

/**
 * Two devices admitted the same patient while offline and the server kept the first. This device's stay is the
 * loser: move its visits onto the surviving stay (each queued to sync, so the server's foreign key is satisfied),
 * drop the losing stay and its queued pushes, and keep the surviving stay locally. Returns how many visits moved.
 * One transaction, so a crash half-way leaves the device as it was.
 */
export async function mergeDuplicateAdmission(losing: Admission, surviving: Admission): Promise<number> {
  return db.transaction('rw', db.admissions, db.visits, db.outbox, async () => {
    const mine = await db.visits.where('patientId').equals(losing.patientId).toArray();
    const moved = repointVisits(mine, losing.id, surviving.id, new Date().toISOString());
    for (const v of moved) {
      await db.visits.put(v);
      await db.outbox.add({ table: 'visits', rowId: v.id, ts: Date.now() });
    }
    await db.admissions.put(surviving);
    await db.admissions.delete(losing.id);
    await db.outbox.where('table').equals('admissions').and((e) => e.rowId === losing.id).delete();
    return moved.length;
  });
}
