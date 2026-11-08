import { beforeEach, describe, expect, it } from 'vitest';
import { createAdmissionService } from './admissionService';
import type { Repos } from '@/repositories/types';
import type { Admission, Visit } from '@/domain/types';

function setup() {
  const stays = new Map<string, Admission>();
  const visits: Visit[] = [];
  const repos = {
    admissions: {
      get: async (id: string) => stays.get(id),
      listByPatient: async (_c: string, patientId: string) => [...stays.values()].filter((a) => a.patientId === patientId && !a.deleted),
      put: async (a: Admission) => void stays.set(a.id, a),
    },
    visits: { list: async (f: { patientId?: string }) => visits.filter((v) => !f.patientId || v.patientId === f.patientId) },
  } as unknown as Repos;
  return { svc: createAdmissionService(repos), stays, visits };
}
const visit = (over: Partial<Visit>) => ({ id: 'v', clinicId: 'c', patientId: 'p', visitDate: '2026-11-05', deleted: false, ...over }) as unknown as Visit;

describe('admissionService', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup(); });

  it('admits with trimmed optional details and refuses a second open stay for the patient', async () => {
    const a = await t.svc.admit('c', 'p', { admittedOn: '2026-11-01', ipdNo: ' IP-9 ', wardBed: '', admittingDoctor: 'Dr Rao' });
    expect(a).toMatchObject({ ipdNo: 'IP-9', wardBed: null, admittingDoctor: 'Dr Rao', dischargedOn: null, deleted: false });
    await expect(t.svc.admit('c', 'p', { admittedOn: '2026-11-02' })).rejects.toThrow(/already admitted/);
    await expect(t.svc.admit('c', 'p2', { admittedOn: '' })).rejects.toThrow(/date of admission/);
    await expect(t.svc.admit('c', 'p2', { admittedOn: '2026-11-02' })).resolves.toBeTruthy();
  });

  it('refuses an empty discharge date, and an admission date after the first session', async () => {
    const a = await t.svc.admit('c', 'p', { admittedOn: '2026-11-01' });
    await expect(t.svc.discharge(a.id, '')).rejects.toThrow(/discharge date/);
    expect(t.stays.get(a.id)?.dischargedOn).toBeNull();
    t.visits.push(visit({ id: 'v1', admissionId: a.id, visitDate: '2026-11-02' }));
    await expect(t.svc.update(a.id, { admittedOn: '2026-11-10' })).rejects.toThrow(/first session/);
    await expect(t.svc.update(a.id, { admittedOn: '2026-11-02' })).resolves.toBeTruthy();
  });

  it('a bed move edits the stay in place', async () => {
    const a = await t.svc.admit('c', 'p', { admittedOn: '2026-11-01', wardBed: 'A1' });
    const b = await t.svc.update(a.id, { admittedOn: '2026-11-01', wardBed: 'B4' });
    expect(b.id).toBe(a.id);
    expect(t.stays.get(a.id)?.wardBed).toBe('B4');
  });

  it('discharges once, not before the admission or the last session, and can be reopened until readmitted', async () => {
    const a = await t.svc.admit('c', 'p', { admittedOn: '2026-11-01' });
    t.visits.push(visit({ id: 'v1', admissionId: a.id, visitDate: '2026-11-06' }));
    await expect(t.svc.discharge(a.id, '2026-10-31')).rejects.toThrow(/before the admission/);
    await expect(t.svc.discharge(a.id, '2026-11-05')).rejects.toThrow(/last session/);
    const d = await t.svc.discharge(a.id, '2026-11-07');
    expect(d.dischargedOn).toBe('2026-11-07');
    await expect(t.svc.discharge(a.id, '2026-11-08')).rejects.toThrow(/already been discharged/);
    const again = await t.svc.admit('c', 'p', { admittedOn: '2026-11-09' });
    await expect(t.svc.reopen(a.id)).rejects.toThrow(/admitted again/);
    await t.svc.deleteMistaken(again.id);
    expect((await t.svc.reopen(a.id)).dischargedOn).toBeNull();
  });

  it('deletes a mistaken stay only when no live session is logged on it', async () => {
    const a = await t.svc.admit('c', 'p', { admittedOn: '2026-11-01' });
    t.visits.push(visit({ id: 'v1', admissionId: a.id }));
    await expect(t.svc.deleteMistaken(a.id)).rejects.toThrow(/cannot be deleted/);
    t.visits[0] = visit({ id: 'v1', admissionId: a.id, deleted: true });
    await t.svc.deleteMistaken(a.id);
    expect(t.stays.get(a.id)?.deleted).toBe(true);
  });
});
