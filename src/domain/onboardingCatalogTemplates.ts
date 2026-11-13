/**
 * Starter service catalog rows for onboarding step 3 — same names, groups, session
 * counts, and suggested prices as `create_clinic_with_admin` used to seed before
 * onboarding owned catalog setup. All fields are editable in the wizard; only rows
 * the admin prices (and leaves enabled) are written to `service_catalog` on finish.
 */

import type { CatalogItem, UUID } from './types';

export interface CatalogTemplateDraft {
  /** Stable React key — not persisted. */
  key: string;
  group: string;
  name: string;
  sessionCount: number;
  /** Suggested starter price in paise; admin can clear or change. */
  basePricePaise: number | null;
  /** When false, row is skipped on finish (removed from the priced catalog). */
  enabled: boolean;
}

/**
 * Two groups only: Consultation and Physiotherapy. A group is a heading for the visit picker, not a treatment: earlier
 * starters made "Manual Therapy" and "Exercise Therapy" one-item service groups, the same words the treatment list uses,
 * which is why many clinics had one-item groups that duplicated their Treatments.
 */
export const STARTER_CATALOG_TEMPLATE: readonly Omit<CatalogTemplateDraft, 'key' | 'enabled'>[] = [
  { group: 'Consultation', name: 'Initial Consultation', sessionCount: 1, basePricePaise: 50000 },
  { group: 'Consultation', name: 'Follow-up Consultation', sessionCount: 1, basePricePaise: 30000 },
  { group: 'Physiotherapy', name: 'Physiotherapy Session', sessionCount: 1, basePricePaise: 80000 },
  { group: 'Physiotherapy', name: 'Physiotherapy Package', sessionCount: 5, basePricePaise: 350000 },
  { group: 'Physiotherapy', name: 'Manual Therapy Session', sessionCount: 1, basePricePaise: 100000 },
  { group: 'Physiotherapy', name: 'Exercise Therapy Session', sessionCount: 1, basePricePaise: 70000 },
];

export function createStarterCatalogDrafts(): CatalogTemplateDraft[] {
  return STARTER_CATALOG_TEMPLATE.map((row) => ({
    ...row,
    key: crypto.randomUUID(),
    enabled: true,
  }));
}

export function groupCatalogDrafts(drafts: CatalogTemplateDraft[]): Map<string, CatalogTemplateDraft[]> {
  const map = new Map<string, CatalogTemplateDraft[]>();
  for (const row of drafts) {
    const g = row.group.trim() || 'Uncategorized';
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(row);
  }
  return map;
}

/** True for a row that has a price entered. ₹0 counts: a clinic that doesn't charge patients prices its services at 0. */
export function isPricedDraft(d: CatalogTemplateDraft): boolean {
  return d.enabled && Boolean(d.name.trim()) && d.basePricePaise != null && d.basePricePaise >= 0;
}

/** At least one enabled row with a price (₹0 allowed) — required to finish onboarding. */
export function catalogDraftsReadyToSave(drafts: CatalogTemplateDraft[]): boolean {
  return drafts.some(isPricedDraft);
}

/** "We don't charge patients": every price to ₹0, so the Payment card never appears on a visit. */
export function zeroCatalogDrafts(drafts: CatalogTemplateDraft[]): CatalogTemplateDraft[] {
  return drafts.map((d) => ({ ...d, basePricePaise: 0 }));
}


/** The starter rows with every price box blank (no example amounts) for the onboarding services screen. */
export function createBlankStarterCatalogDrafts(): CatalogTemplateDraft[] {
  return createStarterCatalogDrafts().map((d) => ({ ...d, basePricePaise: null }));
}

/** True when an included row has a price above 0 (₹0 does not count). */
export function hasPositivePricedDraft(drafts: CatalogTemplateDraft[]): boolean {
  return drafts.some((d) => d.enabled && d.basePricePaise != null && d.basePricePaise > 0);
}

/** Start is allowed: charging needs one price above 0; not charging needs one ticked, named row. */
export function servicesReadyToStart(drafts: CatalogTemplateDraft[], chargesPatients: boolean): boolean {
  return chargesPatients ? hasPositivePricedDraft(drafts) : drafts.some((d) => d.enabled && d.name.trim() !== '');
}

/** The catalog rows to save: priced above 0 when charging, every ticked named row at 0 when not. */
export function catalogItemsFromDrafts(clinicId: UUID, drafts: CatalogTemplateDraft[], now: string, chargesPatients: boolean): CatalogItem[] {
  return drafts
    .filter((d) => (chargesPatients ? d.enabled && d.basePricePaise != null && d.basePricePaise > 0 : d.enabled && d.name.trim() !== ''))
    .map((d) => ({
      id: d.key,
      clinicId,
      category: d.group.trim(),
      name: d.name.trim(),
      sessionCount: Math.max(1, d.sessionCount),
      basePricePaise: chargesPatients ? d.basePricePaise! : 0,
      active: true,
      updatedAt: now,
    }));
}
