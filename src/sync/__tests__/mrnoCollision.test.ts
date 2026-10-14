import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import type { Patient } from '@/domain/types';

const { upsert, serverMrnos, fakeClient } = vi.hoisted(() => {
  const upsert = vi.fn();
  const serverMrnos: string[] = [];
  const fakeClient = {
    from: (table: string) => ({
      upsert: (payload: unknown) => upsert(table, payload),
      select: () => ({
        eq: () => ({
          like: () => ({ order: () => ({ limit: async () => ({ data: serverMrnos.map((mrno) => ({ mrno })), error: null }) }) }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  };
  return { upsert, serverMrnos, fakeClient };
});
vi.mock('@/lib/supabase', () => ({ getSupabase: () => fakeClient }));
vi.mock('@/components/notify', () => ({ notify: { info: vi.fn(), error: vi.fn() }, askConfirm: vi.fn() }));

import { SyncEngine } from '../engine';
import { notify } from '@/components/notify';

const collision = { code: '23505', message: 'duplicate key value violates unique constraint "patients_clinic_id_mrno_key"' };

function patient(over: Partial<Patient> = {}): Patient {
  return {
    id: 'p1', clinicId: 'c1', mrno: 'W26-0001', mrnoSource: 'auto', name: 'Ananya', age: null, sex: null,
    phone: null, email: null, altPhone: null, primaryCondition: null, referringSourceId: null,
    referringSourceDetail: null, deletedAt: null, updatedAt: '2026-10-14T00:00:00.000Z', ...over,
  } as Patient;
}

async function pushOnce() {
  const engine = new SyncEngine() as unknown as { started: boolean; push: () => Promise<void> };
  engine.started = true;
  await engine.push();
}

describe('patient ID collision on push', () => {
  beforeEach(async () => {
    await db.patients.clear();
    await db.outbox.clear();
    upsert.mockReset();
    serverMrnos.length = 0;
    vi.mocked(notify.info).mockClear();
  });

  it('re-issues an auto walk-in ID, pushes again, and keeps the patient (and tells the user)', async () => {
    serverMrnos.push('W26-0001', 'W26-0002');
    await db.patients.put(patient());
    await db.outbox.add({ table: 'patients', rowId: 'p1', ts: 1 });
    upsert.mockResolvedValueOnce({ error: collision }).mockResolvedValueOnce({ error: null });

    await pushOnce();

    expect(upsert).toHaveBeenCalledTimes(2);
    expect((upsert.mock.calls[1][1] as { mrno: string }).mrno).toBe('W26-0003');
    expect((await db.patients.get('p1'))?.mrno).toBe('W26-0003');
    expect(await db.outbox.count()).toBe(0);
    expect(notify.info).toHaveBeenCalledWith(expect.stringContaining('W26-0003'));
  });

  it('keeps a typed hospital ID on collision (never deletes the patient) and stops retrying it every cycle', async () => {
    await db.patients.put(patient({ mrno: 'HOSP-77', mrnoSource: 'hospital' }));
    await db.outbox.add({ table: 'patients', rowId: 'p1', ts: 1 });
    upsert.mockResolvedValue({ error: collision });

    await pushOnce();
    expect(await db.patients.get('p1')).toBeDefined();
    const entry = await db.outbox.toArray();
    expect(entry).toHaveLength(1);
    expect(entry[0].errorCode).toBe('23505');

    upsert.mockClear();
    await pushOnce(); // next cycle: blocked until the ID is edited
    expect(upsert).not.toHaveBeenCalled();

    await db.outbox.add({ table: 'patients', rowId: 'p1', ts: 2 }); // the user edited the patient
    await pushOnce();
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
