import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPatientService } from './patientService';
import { getSupabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({ getSupabase: vi.fn(() => null) }));
import type { Repos } from '@/repositories/types';
import type { Patient } from '@/domain/types';

// In-memory Repos double, scoped to what patientService touches.
function makeFakeRepos() {
  const patients = new Map<string, Patient>();
  const repos = {
    clinics: {
      get: async () => undefined,
    },
    patients: {
      get: async (id: string) => patients.get(id),
      getByMrno: async (clinicId: string, mrno: string) =>
        [...patients.values()].find((p) => p.clinicId === clinicId && p.mrno === mrno),
      search: async () => [],
      list: async (clinicId: string) => [...patients.values()].filter((p) => p.clinicId === clinicId),
      put: async (p: Patient) => void patients.set(p.id, p),
      removeLocal: async (id: string) => void patients.delete(id),
    },
  } as unknown as Repos;
  return { repos, patients };
}

function seedPatient(patients: Map<string, Patient>, overrides: Partial<Patient> = {}): Patient {
  const patient: Patient = {
    id: 'pat-1',
    clinicId: 'clinic-1',
    mrno: 'H-100',
    mrnoSource: 'hospital',
    name: 'Anita Rao',
    age: 34,
    sex: 'F',
    phone: '9999900000',
    primaryCondition: 'Lower back pain',
    deletedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  patients.set(patient.id, patient);
  return patient;
}

describe('patientService.create', () => {
  it('stores the referring source and detail when given', async () => {
    const fake = makeFakeRepos();
    const patient = await createPatientService(fake.repos).create({
      clinicId: 'clinic-1',
      name: 'New Patient',
      referringSourceId: 'src-doctor-referral',
      referringSourceDetail: 'Dr. Mehta',
    });
    expect(patient).toMatchObject({ referringSourceId: 'src-doctor-referral', referringSourceDetail: 'Dr. Mehta' });
  });

  it('defaults referring source to null when omitted', async () => {
    const fake = makeFakeRepos();
    const patient = await createPatientService(fake.repos).create({ clinicId: 'clinic-1', name: 'New Patient' });
    expect(patient.referringSourceId).toBeNull();
    expect(patient.referringSourceDetail).toBeNull();
  });

  it('auto-generates a sequential walk-in MRNO with the default "W" prefix when the clinic has no override', async () => {
    const fake = makeFakeRepos();
    const patient = await createPatientService(fake.repos).create({ clinicId: 'clinic-1', name: 'Walk-in' });
    const yy = String(new Date().getFullYear()).slice(2);
    expect(patient.mrno).toBe(`W${yy}-0001`);
    expect(patient.mrnoSource).toBe('auto');
  });

  it('uses the clinic\'s configured walk-in MRNO prefix when set', async () => {
    const fake = makeFakeRepos();
    fake.repos.clinics.get = async () => ({ walkInMrnoPrefix: 'BM' }) as never;
    const patient = await createPatientService(fake.repos).create({ clinicId: 'clinic-1', name: 'Walk-in' });
    const yy = String(new Date().getFullYear()).slice(2);
    expect(patient.mrno).toBe(`BM${yy}-0001`);
  });

  it('continues the sequence from the highest existing walk-in MRNO this year, ignoring other clinics and years', async () => {
    const fake = makeFakeRepos();
    const yy = String(new Date().getFullYear()).slice(2);
    seedPatient(fake.patients, { id: 'p1', clinicId: 'clinic-1', mrno: `W${yy}-0003`, mrnoSource: 'auto' });
    seedPatient(fake.patients, { id: 'p2', clinicId: 'clinic-1', mrno: `W${yy}-0007`, mrnoSource: 'auto' });
    // A different clinic's higher number, and a hospital-issued MRNO that
    // happens to look similar — neither should influence clinic-1's count.
    seedPatient(fake.patients, { id: 'p3', clinicId: 'clinic-2', mrno: `W${yy}-0099`, mrnoSource: 'auto' });
    seedPatient(fake.patients, { id: 'p4', clinicId: 'clinic-1', mrno: `W19-0050`, mrnoSource: 'auto' });
    const patient = await createPatientService(fake.repos).create({ clinicId: 'clinic-1', name: 'Walk-in' });
    expect(patient.mrno).toBe(`W${yy}-0008`);
  });

  it('skips a colliding number and keeps incrementing until a free one is found', async () => {
    const fake = makeFakeRepos();
    const yy = String(new Date().getFullYear()).slice(2);
    seedPatient(fake.patients, { id: 'p1', clinicId: 'clinic-1', mrno: `W${yy}-0001`, mrnoSource: 'auto' });
    // Simulates a same-numbered row that predates maxWalkInSeq's view
    // (e.g. another offline device) by pre-occupying the very next slot too.
    seedPatient(fake.patients, { id: 'p2', clinicId: 'clinic-1', mrno: `W${yy}-0002`, mrnoSource: 'auto' });
    const patient = await createPatientService(fake.repos).create({ clinicId: 'clinic-1', name: 'Walk-in' });
    expect(patient.mrno).toBe(`W${yy}-0003`);
  });

  it('auto-widens past 4 digits once a clinic passes 9999 walk-ins in a year', async () => {
    const fake = makeFakeRepos();
    const yy = String(new Date().getFullYear()).slice(2);
    seedPatient(fake.patients, { id: 'p1', clinicId: 'clinic-1', mrno: `W${yy}-9999`, mrnoSource: 'auto' });
    const patient = await createPatientService(fake.repos).create({ clinicId: 'clinic-1', name: 'Walk-in' });
    expect(patient.mrno).toBe(`W${yy}-10000`);
  });
});

describe('patientService.update', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('updates a non-MRNO field and bumps updatedAt', async () => {
    const original = seedPatient(fake.patients);
    const updated = await createPatientService(fake.repos).update(original.id, { age: 35 });
    expect(updated.age).toBe(35);
    expect(updated.updatedAt).not.toBe(original.updatedAt);
    expect((await fake.repos.patients.get(original.id))?.age).toBe(35);
  });

  it('changes the MRNO to a free value', async () => {
    const original = seedPatient(fake.patients);
    const updated = await createPatientService(fake.repos).update(original.id, { mrno: 'H-200' });
    expect(updated.mrno).toBe('H-200');
    expect(await fake.repos.patients.getByMrno('clinic-1', 'H-200')).toMatchObject({ id: original.id });
  });

  it('rejects an MRNO change that collides with a different patient', async () => {
    const a = seedPatient(fake.patients, { id: 'pat-1', mrno: 'H-100' });
    seedPatient(fake.patients, { id: 'pat-2', mrno: 'H-200', name: 'Other Patient' });
    const svc = createPatientService(fake.repos);
    await expect(svc.update(a.id, { mrno: 'H-200' })).rejects.toThrow(/H-200 already exists \(Other Patient\)/);
    expect((await fake.repos.patients.get(a.id))?.mrno).toBe('H-100');
  });

  it('does not false-positive when MRNO is "changed" to its own current value', async () => {
    const original = seedPatient(fake.patients);
    const updated = await createPatientService(fake.repos).update(original.id, { mrno: original.mrno });
    expect(updated.mrno).toBe(original.mrno);
  });

  it('throws for a nonexistent patient', async () => {
    const svc = createPatientService(fake.repos);
    await expect(svc.update('missing', { age: 40 })).rejects.toThrow('Patient not found');
  });

  it('clears a nullable field to null rather than ignoring it', async () => {
    const original = seedPatient(fake.patients);
    const updated = await createPatientService(fake.repos).update(original.id, { phone: null });
    expect(updated.phone).toBeNull();
  });

  it('leaves all fields unchanged besides updatedAt for an empty patch', async () => {
    const original = seedPatient(fake.patients);
    const updated = await createPatientService(fake.repos).update(original.id, {});
    expect(updated).toMatchObject({ ...original, updatedAt: updated.updatedAt });
    expect(updated.updatedAt).not.toBe(original.updatedAt);
  });

  it('leaves mrnoSource untouched after an MRNO edit', async () => {
    const original = seedPatient(fake.patients, { mrnoSource: 'auto', mrno: 'W-260704-ABC' });
    const updated = await createPatientService(fake.repos).update(original.id, { mrno: 'H-999' });
    expect(updated.mrnoSource).toBe('auto');
  });

  it('sets the referring source and detail on an existing patient', async () => {
    const original = seedPatient(fake.patients);
    const updated = await createPatientService(fake.repos).update(original.id, {
      referringSourceId: 'src-word-of-mouth',
      referringSourceDetail: 'Referred by Anita Rao',
    });
    expect(updated).toMatchObject({
      referringSourceId: 'src-word-of-mouth',
      referringSourceDetail: 'Referred by Anita Rao',
    });
  });
});

describe('patientService.create walk-in IDs from the server', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(getSupabase).mockReturnValue(null as never);
  });

  const rpcClient = (result: { data: unknown; error: unknown }) => {
    const rpc = vi.fn(async () => result);
    vi.mocked(getSupabase).mockReturnValue({ rpc } as never);
    return rpc;
  };

  it('uses the number the server reserves when online', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const rpc = rpcClient({ data: 'W26-0042', error: null });
    const { repos } = makeFakeRepos();
    const patient = await createPatientService(repos).create({ clinicId: 'clinic-1', name: 'Walk In' });
    expect(patient.mrno).toBe('W26-0042');
    expect(patient.mrnoSource).toBe('auto');
    expect(rpc).toHaveBeenCalledWith('reserve_walk_in_mrno', expect.objectContaining({ p_clinic_id: 'clinic-1' }));
  });

  it('falls back to the local list when the server call fails or the device is offline', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    rpcClient({ data: null, error: { message: 'boom' } });
    const { repos, patients } = makeFakeRepos();
    seedPatient(patients, { mrno: `W${String(new Date().getFullYear()).slice(2)}-0003`, mrnoSource: 'auto' });
    const viaError = await createPatientService(repos).create({ clinicId: 'clinic-1', name: 'A' });
    expect(viaError.mrno.endsWith('-0004')).toBe(true);

    vi.stubGlobal('navigator', { onLine: false });
    const rpc = rpcClient({ data: 'W26-0999', error: null });
    const offline = await createPatientService(repos).create({ clinicId: 'clinic-1', name: 'B' });
    expect(rpc).not.toHaveBeenCalled();
    expect(offline.mrno.endsWith('-0005')).toBe(true);
  });

  it('ignores a reserved number that is already used locally and mints locally instead', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const yy = String(new Date().getFullYear()).slice(2);
    rpcClient({ data: `W${yy}-0001`, error: null });
    const { repos, patients } = makeFakeRepos();
    seedPatient(patients, { mrno: `W${yy}-0001`, mrnoSource: 'auto' });
    const patient = await createPatientService(repos).create({ clinicId: 'clinic-1', name: 'C' });
    expect(patient.mrno).toBe(`W${yy}-0002`);
  });
});

describe('patientService.setFollowUp', () => {
  it('sets the target date, note and therapist, stamped with the day it was set', async () => {
    const fake = makeFakeRepos();
    seedPatient(fake.patients);
    const svc = createPatientService(fake.repos);
    const out = await svc.setFollowUp('pat-1', { on: '2026-10-30', note: '  reassess knee ', therapistId: 'th-1' }, '2026-10-28');
    expect(out).toMatchObject({ followUpOn: '2026-10-30', followUpNote: 'reassess knee', followUpTherapistId: 'th-1', followUpSetOn: '2026-10-28' });
    expect(fake.patients.get('pat-1')?.followUpOn).toBe('2026-10-30');
    // the rest of the patient is untouched
    expect(out.name).toBe('Anita Rao');
  });

  it('changing the date re-stamps the day it was set; null dismisses it', async () => {
    const fake = makeFakeRepos();
    seedPatient(fake.patients);
    const svc = createPatientService(fake.repos);
    await svc.setFollowUp('pat-1', { on: '2026-10-30' }, '2026-10-28');
    const moved = await svc.setFollowUp('pat-1', { on: '2026-11-05' }, '2026-10-31');
    expect(moved.followUpSetOn).toBe('2026-10-31');
    const cleared = await svc.setFollowUp('pat-1', null);
    expect(cleared).toMatchObject({ followUpOn: null, followUpNote: null, followUpTherapistId: null, followUpSetOn: null });
  });

  it('refuses a past or malformed date, an over-long note and an unknown patient', async () => {
    const fake = makeFakeRepos();
    seedPatient(fake.patients);
    const svc = createPatientService(fake.repos);
    await expect(svc.setFollowUp('pat-1', { on: '2026-10-27' }, '2026-10-28')).rejects.toThrow(/today or a later date/);
    await expect(svc.setFollowUp('pat-1', { on: 'soon' }, '2026-10-28')).rejects.toThrow(/Pick a date/);
    await expect(svc.setFollowUp('pat-1', { on: '2026-10-30', note: 'x'.repeat(201) }, '2026-10-28')).rejects.toThrow(/under 200/);
    await expect(svc.setFollowUp('nope', { on: '2026-10-30' }, '2026-10-28')).rejects.toThrow(/not found/);
  });
});
