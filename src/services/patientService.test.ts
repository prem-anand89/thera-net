import { beforeEach, describe, expect, it } from 'vitest';
import { createPatientService } from './patientService';
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
      getByMrno: async (_c: string, mrno: string) => [...patients.values()].find((p) => p.mrno === mrno),
      search: async () => [],
      list: async () => [...patients.values()],
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
      referringSource: 'doctor_referral',
      referringSourceDetail: 'Dr. Mehta',
    });
    expect(patient).toMatchObject({ referringSource: 'doctor_referral', referringSourceDetail: 'Dr. Mehta' });
  });

  it('defaults referring source to null when omitted', async () => {
    const fake = makeFakeRepos();
    const patient = await createPatientService(fake.repos).create({ clinicId: 'clinic-1', name: 'New Patient' });
    expect(patient.referringSource).toBeNull();
    expect(patient.referringSourceDetail).toBeNull();
  });

  it('auto-generates a walk-in MRNO with the default "W" prefix when the clinic has no override', async () => {
    const fake = makeFakeRepos();
    const patient = await createPatientService(fake.repos).create({ clinicId: 'clinic-1', name: 'Walk-in' });
    expect(patient.mrno).toMatch(/^W-\d{6}-[A-Z0-9]{3}$/);
    expect(patient.mrnoSource).toBe('auto');
  });

  it('uses the clinic\'s configured walk-in MRNO prefix when set', async () => {
    const fake = makeFakeRepos();
    fake.repos.clinics.get = async () => ({ walkInMrnoPrefix: 'BM' }) as never;
    const patient = await createPatientService(fake.repos).create({ clinicId: 'clinic-1', name: 'Walk-in' });
    expect(patient.mrno).toMatch(/^BM-\d{6}-[A-Z0-9]{3}$/);
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
      referringSource: 'word_of_mouth',
      referringSourceDetail: 'Referred by Anita Rao',
    });
    expect(updated).toMatchObject({
      referringSource: 'word_of_mouth',
      referringSourceDetail: 'Referred by Anita Rao',
    });
  });

  it('clears the referring source to null rather than ignoring it', async () => {
    const original = seedPatient(fake.patients, { referringSource: 'online', referringSourceDetail: 'Instagram' });
    const updated = await createPatientService(fake.repos).update(original.id, {
      referringSource: null,
      referringSourceDetail: null,
    });
    expect(updated.referringSource).toBeNull();
    expect(updated.referringSourceDetail).toBeNull();
  });
});
