import type { Patient, MrnoSource, UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { getSupabase } from '@/lib/supabase';

export interface NewPatientInput {
  clinicId: UUID;
  mrno?: string;
  name: string;
  age?: number | null;
  sex?: 'M' | 'F' | 'Other' | null;
  phone?: string | null;
  primaryCondition?: string | null;
  referringSourceId?: UUID | null;
  referringSourceDetail?: string | null;
}

export interface UpdatePatientInput {
  mrno?: string;
  name?: string;
  age?: number | null;
  sex?: 'M' | 'F' | 'Other' | null;
  phone?: string | null;
  primaryCondition?: string | null;
  referringSourceId?: UUID | null;
  referringSourceDetail?: string | null;
}

/**
 * MRNO policy (confirmed with user): normally the hospital issues the MRNO
 * and it is typed in; walk-ins without a hospital registration get an
 * app-generated one, visibly prefixed so the two never collide. The prefix
 * itself is a per-clinic Setup preference (defaults to 'W').
 *
 * Format: {prefix}{YY}-{seq}, e.g. W26-0001 — sequential per clinic per
 * calendar year, not the effectively-unguessable date+random suffix this
 * used to be. Reset each January (new YY means the pattern below no longer
 * matches last year's rows, so the scan starts back at 1); the sequence is
 * zero-padded to 4 digits and auto-widens past 9999 for a clinic large
 * enough to need it — padStart is a no-op once the number is already
 * longer than the pad width, so no separate "large clinic" setting exists
 * or is needed for that.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Highest {prefix}{YY}-NNNN sequence already used by this clinic this year, or 0 if none. */
function maxWalkInSeq(mrnos: string[], prefix: string, yy: string): number {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}${yy}-(\\d+)$`);
  let max = 0;
  for (const mrno of mrnos) {
    const match = pattern.exec(mrno);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

export function createPatientService(repos: Repos) {
  return {
    async create(input: NewPatientInput): Promise<Patient> {
      const manual = input.mrno?.trim();
      let mrno: string;
      let mrnoSource: MrnoSource;
      if (manual) {
        const existing = await repos.patients.getByMrno(input.clinicId, manual);
        if (existing) throw new Error(`Patient ID ${manual} already exists (${existing.name}).`);
        mrno = manual;
        mrnoSource = 'hospital';
      } else {
        const clinic = await repos.clinics.get(input.clinicId);
        const prefix = clinic?.walkInMrnoPrefix?.trim() || 'W';
        const yy = String(new Date().getFullYear()).slice(2);
        // Includes hidden patients (repos.patients.list does) so a hidden
        // duplicate never frees up its number for reuse.
        const existingMrnos = (await repos.patients.list(input.clinicId)).map((p) => p.mrno);
        let seq = maxWalkInSeq(existingMrnos, prefix, yy) + 1;
        do {
          mrno = `${prefix}${yy}-${String(seq).padStart(4, '0')}`;
          seq += 1;
        } while (await repos.patients.getByMrno(input.clinicId, mrno));
        mrnoSource = 'auto';
      }

      const patient: Patient = {
        id: crypto.randomUUID(),
        clinicId: input.clinicId,
        mrno,
        mrnoSource,
        name: input.name.trim(),
        age: input.age ?? null,
        sex: input.sex ?? null,
        phone: input.phone?.trim() || null,
        primaryCondition: input.primaryCondition?.trim() || null,
        referringSourceId: input.referringSourceId ?? null,
        referringSourceDetail: input.referringSourceDetail?.trim() || null,
        deletedAt: null,
        updatedAt: new Date().toISOString(),
      };
      await repos.patients.put(patient);
      return patient;
    },

    /**
     * Correct details entered wrong or left blank on a rushed first visit.
     * Read-merge-put like hide/restore, so it works fully offline. MRNO
     * uniqueness is re-checked (excluding this patient) if it's changing;
     * mrnoSource is left untouched — it records how the patient was
     * originally registered, not what the MRNO reads today.
     */
    async update(id: UUID, patch: UpdatePatientInput): Promise<Patient> {
      const patient = await repos.patients.get(id);
      if (!patient) throw new Error('Patient not found');

      let mrno = patient.mrno;
      if (patch.mrno !== undefined) {
        const trimmed = patch.mrno.trim();
        if (!trimmed) throw new Error('Patient ID cannot be empty.');
        if (trimmed !== patient.mrno) {
          const existing = await repos.patients.getByMrno(patient.clinicId, trimmed);
          if (existing && existing.id !== id) {
            throw new Error(`Patient ID ${trimmed} already exists (${existing.name}).`);
          }
          mrno = trimmed;
        }
      }

      const updated: Patient = {
        ...patient,
        mrno,
        name: patch.name !== undefined ? patch.name.trim() : patient.name,
        age: patch.age !== undefined ? patch.age : patient.age,
        sex: patch.sex !== undefined ? patch.sex : patient.sex,
        phone: patch.phone !== undefined ? patch.phone?.trim() || null : patient.phone,
        primaryCondition:
          patch.primaryCondition !== undefined
            ? patch.primaryCondition?.trim() || null
            : patient.primaryCondition,
        referringSourceId:
          patch.referringSourceId !== undefined ? patch.referringSourceId : patient.referringSourceId,
        referringSourceDetail:
          patch.referringSourceDetail !== undefined
            ? patch.referringSourceDetail?.trim() || null
            : patient.referringSourceDetail,
        updatedAt: new Date().toISOString(),
      };
      await repos.patients.put(updated);
      return updated;
    },

    /**
     * Hide (soft delete): the default remediation for duplicates/mistakes.
     * A normal outboxed update, so it propagates to every device — unlike a
     * hard delete, which the sync engine cannot propagate. Visits keep
     * resolving the patient's name; only search/pickers stop showing them.
     */
    async hide(id: UUID): Promise<void> {
      const patient = await repos.patients.get(id);
      if (!patient) throw new Error('Patient not found');
      await repos.patients.put({
        ...patient,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    },

    async restore(id: UUID): Promise<void> {
      const patient = await repos.patients.get(id);
      if (!patient) throw new Error('Patient not found');
      await repos.patients.put({
        ...patient,
        deletedAt: null,
        updatedAt: new Date().toISOString(),
      });
    },

    /**
     * Permanent delete, zero-visit patients only — enforced server-side by
     * the hard_delete_patient RPC. Online-only because deletes don't travel
     * through the offline outbox.
     */
    async hardDelete(id: UUID): Promise<void> {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase is not configured');
      if (!navigator.onLine) {
        throw new Error('Deleting permanently needs a connection — try again when online.');
      }
      const { error } = await supabase.rpc('hard_delete_patient', { p_patient_id: id });
      if (error) throw new Error(error.message);
      await repos.patients.removeLocal(id);
    },
  };
}
