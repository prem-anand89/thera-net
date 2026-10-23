import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { deliverer } from '@/domain/visitLines';
import type { Paise } from '@/domain/money';
import type { UUID, Visit, VisitCredit, VisitItem } from '@/domain/types';

/**
 * A visit a therapist took part in but did not bill: they delivered at least one of its live service
 * lines and the visit belongs to someone else. They see it in their own lists as an "Assisted" row —
 * their services, the patient, who the visit is under and their own share — and nothing about the
 * bill, payment or invoice, which stay with the primary therapist. It is never part of their Dues,
 * Collected or the Ledger totals (those are built from the primary's visits only).
 */
export interface AssistedVisit {
  visitId: UUID;
  visitDate: string;
  patientId: UUID;
  /** The services this therapist delivered on the visit. */
  services: string[];
  primaryTherapistId: UUID;
  primaryName: string;
  /** This therapist's own share of the bill; null when the revenue is not shared with them. */
  sharePaise: Paise | null;
}

/** The visits `therapistId` assisted on, newest first. Pure: callers supply the rows and names. */
export function assistedVisitsFor(
  therapistId: UUID,
  visits: Visit[],
  items: VisitItem[],
  credits: VisitCredit[],
  nameOf: (id: UUID) => string,
  splitEnabled: boolean
): AssistedVisit[] {
  const linesBy = new Map<UUID, VisitItem[]>();
  for (const i of items) {
    if (i.deleted) continue;
    linesBy.set(i.visitId, [...(linesBy.get(i.visitId) ?? []), i]);
  }
  const shareBy = new Map<UUID, Paise>();
  for (const c of credits) {
    if (c.deleted || c.therapistId !== therapistId) continue;
    shareBy.set(c.visitId, (shareBy.get(c.visitId) ?? 0) + c.amountPaise);
  }
  const out: AssistedVisit[] = [];
  for (const v of visits) {
    if (v.deleted || v.therapistId === therapistId) continue;
    const mine = (linesBy.get(v.id) ?? [])
      .filter((l) => deliverer(l, v.therapistId) === therapistId)
      .sort((a, b) => a.position - b.position);
    if (mine.length === 0) continue;
    out.push({
      visitId: v.id,
      visitDate: v.visitDate,
      patientId: v.patientId,
      services: mine.map((l) => l.serviceName),
      primaryTherapistId: v.therapistId,
      primaryName: nameOf(v.therapistId),
      sharePaise: splitEnabled ? (shareBy.get(v.id) ?? null) : null,
    });
  }
  return out.sort((a, b) => b.visitDate.localeCompare(a.visitDate));
}

/** Loads the visits in a range (optionally one patient's) and returns those `therapistId` assisted on. */
export function useAssistedVisits(
  clinicId: UUID,
  therapistId: UUID | undefined,
  range: { from?: string; to?: string; patientId?: UUID },
  nameOf: (id: UUID) => string,
  splitEnabled: boolean,
  excludeVisitIds?: Set<UUID>
): AssistedVisit[] {
  const { from, to, patientId } = range;
  const data = useLiveQuery(async () => {
    if (!therapistId) return null;
    const visits = await repos.visits.list({ clinicId, from, to, patientId });
    const others = visits.filter((v) => !v.deleted && v.therapistId !== therapistId);
    const ids = others.map((v) => v.id);
    const [items, credits] = ids.length
      ? await Promise.all([repos.visitItems.listByVisitIds(ids), repos.visitCredits.listByVisitIds(ids)])
      : [[], []];
    return { visits: others, items, credits };
  }, [clinicId, therapistId, from, to, patientId]);
  return useMemo(() => {
    if (!data || !therapistId) return [];
    return assistedVisitsFor(therapistId, data.visits, data.items, data.credits, nameOf, splitEnabled).filter(
      (a) => !excludeVisitIds?.has(a.visitId)
    );
  }, [data, therapistId, nameOf, splitEnabled, excludeVisitIds]);
}
