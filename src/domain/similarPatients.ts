import type { Patient } from './types';
import { DUPLICATE_NAME_THRESHOLD, nameSimilarity } from './nameSimilarity';
import { lastTenDigits } from './phoneDigits';

export type SimilarMatch = { patient: Patient; matchedBy: 'phone' | 'name'; score: number };

/**
 * Existing patients who could be the person being typed: the same phone (last 10 digits) or a
 * near-identical name. Phone matches come first, then closer names. Hidden patients are skipped.
 */
export function findSimilarPatients(patients: Patient[], name: string, phone: string, limit = 3): SimilarMatch[] {
  const typedName = name.trim();
  const typedPhone = lastTenDigits(phone);
  const phoneUsable = typedPhone.length >= 7;
  if (!typedName && !phoneUsable) return [];
  const matches: SimilarMatch[] = [];
  for (const patient of patients) {
    if (patient.deletedAt) continue;
    if (phoneUsable && lastTenDigits(patient.phone) === typedPhone) {
      matches.push({ patient, matchedBy: 'phone', score: 1 });
      continue;
    }
    if (!typedName) continue;
    const score = nameSimilarity(patient.name, typedName);
    if (score >= DUPLICATE_NAME_THRESHOLD) matches.push({ patient, matchedBy: 'name', score });
  }
  return matches
    .sort((a, b) => (a.matchedBy === b.matchedBy ? b.score - a.score : a.matchedBy === 'phone' ? -1 : 1))
    .slice(0, limit);
}

/** "BM-0042 · 34 F · Ankle sprain · seen 12 Oct": what tells two people of the same name apart. */
export function patientSummary(patient: Patient, lastVisitOn?: string | null): string {
  const ageSex = [patient.age != null ? String(patient.age) : '', patient.sex === 'M' ? 'M' : patient.sex === 'F' ? 'F' : patient.sex ? 'Other' : '']
    .filter(Boolean)
    .join(' ');
  const seen = lastVisitOn
    ? `seen ${new Date(`${lastVisitOn}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
    : '';
  return [patient.mrno, ageSex, patient.primaryCondition?.trim() ?? '', seen].filter(Boolean).join(' · ');
}
