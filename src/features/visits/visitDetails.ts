import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import type { UUID, VisitCredit, VisitItem } from '@/domain/types';

/** What a visit's details show beyond the single service column: each service with its assistant, and the shares. */
export interface VisitDetails {
  services: { name: string; assistantName: string | null }[];
  /** Only when the bill is shared between several therapists; null otherwise. */
  shares: { name: string; amountPaise: number }[] | null;
  /** The visit has share rows at all (even a single one): then the old shared_* columns are not shown. */
  hasShareRows: boolean;
}

/**
 * The split flags for a row: share rows rule whenever they exist; the old one-assistant split
 * (`sharedTherapistId`/`sharedPct`) shows only for a visit with no share rows.
 */
export function splitDisplay(
  details: VisitDetails | undefined,
  legacy: { sharedTherapistId?: UUID | null; sharedPct?: number | null }
): { hasSplit: boolean; legacySplit: boolean } {
  const legacySplit = Boolean(legacy.sharedTherapistId) && !details?.hasShareRows;
  return { hasSplit: Boolean(details?.shares) || legacySplit, legacySplit };
}

/** Pure: lines and shares per visit → the read-only details. Visits with no lines get nothing. */
export function buildVisitDetails(
  items: VisitItem[],
  credits: VisitCredit[],
  nameOf: (therapistId: UUID) => string,
  splitEnabled: boolean
): Map<UUID, VisitDetails> {
  const out = new Map<UUID, VisitDetails>();
  const linesBy = new Map<UUID, VisitItem[]>();
  for (const i of items) {
    if (i.deleted) continue;
    linesBy.set(i.visitId, [...(linesBy.get(i.visitId) ?? []), i]);
  }
  const sharesBy = new Map<UUID, VisitCredit[]>();
  for (const c of credits) {
    if (c.deleted) continue;
    sharesBy.set(c.visitId, [...(sharesBy.get(c.visitId) ?? []), c]);
  }
  for (const visitId of new Set([...linesBy.keys(), ...sharesBy.keys()])) {
    const lines = linesBy.get(visitId) ?? [];
    const shares = sharesBy.get(visitId) ?? [];
    out.set(visitId, {
      services: [...lines]
        .sort((a, b) => a.position - b.position)
        .map((l) => ({
          name: l.serviceName,
          assistantName: l.assistingTherapistId ? nameOf(l.assistingTherapistId) : null,
        })),
      shares:
        splitEnabled && shares.length > 1
          ? shares.map((c) => ({ name: nameOf(c.therapistId), amountPaise: c.amountPaise }))
          : null,
      hasShareRows: shares.length > 0,
    });
  }
  return out;
}

/** Loads and builds the details for a list of visits (Ledger, patient history). */
export function useVisitDetails(
  visitIds: UUID[],
  nameOf: (therapistId: UUID) => string,
  splitEnabled: boolean
): Map<UUID, VisitDetails> {
  const key = visitIds.join(',');
  const items = useLiveQuery(
    () => (visitIds.length ? repos.visitItems.listByVisitIds(visitIds) : []),
    [key]
  );
  const credits = useLiveQuery(
    () => (visitIds.length ? repos.visitCredits.listByVisitIds(visitIds) : []),
    [key]
  );
  return useMemo(
    () => buildVisitDetails(items ?? [], credits ?? [], nameOf, splitEnabled),
    [items, credits, nameOf, splitEnabled]
  );
}
