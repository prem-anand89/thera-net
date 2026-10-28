import type { Patient, MrnoSource, UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { getSupabase } from '@/lib/supabase';
import { formatWalkInMrno, maxWalkInSeq } from '@/domain/walkInMrno';
import { toLocalDateStr } from '@/domain/schedule';

export interface NewPatientInput {
  clinicId: UUID;
  mrno?: string;
  name: string;
  age?: number | null;
  sex?: 'M' | 'F' | 'Other' | null;
  phone?: string | null;
  email?: string | null;
  altPhone?: string | null;
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
  email?: string | null;
  altPhone?: string | null;
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

/** Asks the server for the next walk-in ID. Null when offline or the call fails (the caller mints locally). */
async function reserveWalkInMrno(clinicId: UUID, prefix: string, yy: string): Promise<string | null> {
  try {
    const supabase = getSupabase();
    if (!supabase || typeof navigator === 'undefined' || !navigator.onLine) return null;
    const { data, error } = await supabase.rpc('reserve_walk_in_mrno', { p_clinic_id: clinicId, p_prefix: prefix, p_yy: yy });
    if (error || typeof data !== 'string') return null;
    return data;
  } catch {
    return null;
  }
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
        // Online: the server hands out the number (a persistent per-clinic
        // counter), so two devices cannot mint the same one. Offline or on any
        // failure: mint from the local list as before; if two offline devices
        // collide, the sync engine re-issues the later one on push.
        const reserved = await reserveWalkInMrno(input.clinicId, prefix, yy);
        if (reserved && !(await repos.patients.getByMrno(input.clinicId, reserved))) {
          mrno = reserved;
        } else {
          // Includes hidden patients (repos.patients.list does) so a hidden
          // duplicate never frees up its number for reuse.
          const existingMrnos = (await repos.patients.list(input.clinicId)).map((p) => p.mrno);
          let seq = maxWalkInSeq(existingMrnos, prefix, yy) + 1;
          do {
            mrno = formatWalkInMrno(prefix, yy, seq);
            seq += 1;
          } while (await repos.patients.getByMrno(input.clinicId, mrno));
        }
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
        email: input.email?.trim() || null,
        altPhone: input.altPhone?.trim() || null,
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
        email: patch.email !== undefined ? patch.email?.trim() || null : patient.email ?? null,
        altPhone: patch.altPhone !== undefined ? patch.altPhone?.trim() || null : patient.altPhone ?? null,
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
     * Sets, changes or (with null) dismisses the patient's follow-up review. A target date, not a held slot; one
     * per patient. Allowed for any clinic member and on any patient, and never touches billing. `setOn` (today) is
     * what a later visit or appointment is measured against to know it was fulfilled (domain/followUp.ts).
     */
    async setFollowUp(
      id: UUID,
      input: { on: string; note?: string | null; therapistId?: UUID | null } | null,
      today: string = toLocalDateStr(new Date())
    ): Promise<Patient> {
      const patient = await repos.patients.get(id);
      if (!patient) throw new Error('Patient not found');
      let fields: Pick<Patient, 'followUpOn' | 'followUpNote' | 'followUpTherapistId' | 'followUpSetOn'>;
      if (!input) {
        fields = { followUpOn: null, followUpNote: null, followUpTherapistId: null, followUpSetOn: null };
      } else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.on)) throw new Error('Pick a date for the follow-up.');
        if (input.on < today) throw new Error('Pick today or a later date for the follow-up.');
        const note = input.note?.trim() || null;
        if (note && note.length > 200) throw new Error('Keep the follow-up note under 200 characters.');
        fields = {
          followUpOn: input.on,
          followUpNote: note,
          followUpTherapistId: input.therapistId ?? null,
          followUpSetOn: today,
        };
      }
      const updated: Patient = { ...patient, ...fields, updatedAt: new Date().toISOString() };
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
