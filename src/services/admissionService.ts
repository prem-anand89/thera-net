import type { Admission, UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { admissionDateProblem, openAdmissionOf } from '@/domain/admissions';

export interface AdmissionDetails {
  admittedOn: string;
  ipdNo?: string | null;
  wardBed?: string | null;
  admittingDoctor?: string | null;
  notes?: string | null;
}

const clean = (v: string | null | undefined) => v?.trim() || null;

/**
 * Inpatient stays. Everything is offline-first (an outbox write like a visit): the server's plan check and its
 * one-open-stay index answer at sync time, so this service checks what it can first (one open stay per patient on
 * this device) and the sync engine handles a second device admitting the same patient.
 */
export function createAdmissionService(repos: Repos) {
  async function getOrThrow(id: UUID): Promise<Admission> {
    const a = await repos.admissions.get(id);
    if (!a || a.deleted) throw new Error('This stay was not found.');
    return a;
  }

  return {
    /** Admits a patient. Refused when they already have an open stay. */
    async admit(clinicId: UUID, patientId: UUID, details: AdmissionDetails): Promise<Admission> {
      const problem = admissionDateProblem(details.admittedOn, null);
      if (problem) throw new Error(problem);
      const existing = openAdmissionOf(await repos.admissions.listByPatient(clinicId, patientId));
      if (existing) throw new Error('This patient is already admitted. Discharge the current stay first.');
      const stay: Admission = {
        id: crypto.randomUUID(),
        clinicId,
        patientId,
        ipdNo: clean(details.ipdNo),
        wardBed: clean(details.wardBed),
        admittingDoctor: clean(details.admittingDoctor),
        admittedOn: details.admittedOn,
        dischargedOn: null,
        notes: clean(details.notes),
        deleted: false,
        updatedAt: new Date().toISOString(),
      };
      await repos.admissions.put(stay);
      return stay;
    },

    /** Changes the details of a stay (ward/bed, IPD no, doctor, notes, admission date). A bed move edits in place. */
    async update(id: UUID, details: AdmissionDetails): Promise<Admission> {
      const current = await getOrThrow(id);
      const problem = admissionDateProblem(details.admittedOn, current.dischargedOn);
      if (problem) throw new Error(problem);
      const first = (await this.visitsOf(current)).map((v) => v.visitDate).sort()[0];
      if (first && details.admittedOn > first) {
        throw new Error('The admission date cannot be after the first session on this stay.');
      }
      const next: Admission = {
        ...current,
        ipdNo: clean(details.ipdNo),
        wardBed: clean(details.wardBed),
        admittingDoctor: clean(details.admittingDoctor),
        admittedOn: details.admittedOn,
        notes: clean(details.notes),
        updatedAt: new Date().toISOString(),
      };
      await repos.admissions.put(next);
      return next;
    },

    /** Closes the stay on a date (not before the admission, not before its last visit). */
    async discharge(id: UUID, dischargedOn: string): Promise<Admission> {
      const current = await getOrThrow(id);
      if (current.dischargedOn) throw new Error('This patient has already been discharged.');
      const problem = admissionDateProblem(current.admittedOn, dischargedOn);
      if (problem) throw new Error(problem);
      const visits = await this.visitsOf(current);
      const last = visits.map((v) => v.visitDate).sort().pop();
      if (last && dischargedOn < last) {
        throw new Error('The discharge date cannot be before the last session on this stay.');
      }
      const next: Admission = { ...current, dischargedOn, updatedAt: new Date().toISOString() };
      await repos.admissions.put(next);
      return next;
    },

    /** Undoes a discharge made by mistake, unless the patient has been admitted again since. */
    async reopen(id: UUID): Promise<Admission> {
      const current = await getOrThrow(id);
      if (!current.dischargedOn) return current;
      const open = openAdmissionOf(await repos.admissions.listByPatient(current.clinicId, current.patientId));
      if (open) throw new Error('This patient has been admitted again, so the earlier stay cannot be reopened.');
      const next: Admission = { ...current, dischargedOn: null, updatedAt: new Date().toISOString() };
      await repos.admissions.put(next);
      return next;
    },

    /** Deletes a stay entered by mistake. Refused while any live visit is logged against it. */
    async deleteMistaken(id: UUID): Promise<void> {
      const current = await getOrThrow(id);
      if ((await this.visitsOf(current)).length > 0) {
        throw new Error('Sessions have been logged on this stay, so it cannot be deleted.');
      }
      await repos.admissions.put({ ...current, deleted: true, updatedAt: new Date().toISOString() });
    },

    /** The live visits logged against a stay. Visits are read by patient and filtered: there is no index on the stay. */
    async visitsOf(stay: Pick<Admission, 'id' | 'clinicId' | 'patientId'>) {
      const visits = await repos.visits.list({ clinicId: stay.clinicId, patientId: stay.patientId });
      return visits.filter((v) => !v.deleted && v.admissionId === stay.id);
    },
  };
}

export type AdmissionService = ReturnType<typeof createAdmissionService>;
