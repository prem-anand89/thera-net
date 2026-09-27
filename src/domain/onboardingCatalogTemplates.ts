/**
 * Starter service catalog rows for onboarding step 3 — same names, groups, session
 * counts, and suggested prices as `create_clinic_with_admin` used to seed before
 * onboarding owned catalog setup. All fields are editable in the wizard; only rows
 * the admin prices (and leaves enabled) are written to `service_catalog` on finish.
 */

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

export const STARTER_CATALOG_TEMPLATE: readonly Omit<CatalogTemplateDraft, 'key' | 'enabled'>[] = [
  { group: 'Consultation', name: 'Initial Consultation', sessionCount: 1, basePricePaise: 50000 },
  { group: 'Consultation', name: 'Follow-up Consultation', sessionCount: 1, basePricePaise: 30000 },
  { group: 'Physiotherapy', name: 'Physiotherapy Session', sessionCount: 1, basePricePaise: 80000 },
  { group: 'Physiotherapy', name: 'Physiotherapy Package (5)', sessionCount: 5, basePricePaise: 350000 },
  { group: 'Manual Therapy', name: 'Manual Therapy Session', sessionCount: 1, basePricePaise: 100000 },
  { group: 'Exercise Therapy', name: 'Exercise Therapy Session', sessionCount: 1, basePricePaise: 70000 },
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
  for (const [, list] of map) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

/** At least one enabled row with a positive price — required to finish onboarding. */
export function catalogDraftsReadyToSave(drafts: CatalogTemplateDraft[]): boolean {
  return drafts.some((d) => d.enabled && d.name.trim() && d.basePricePaise != null && d.basePricePaise > 0);
}

export function renameCatalogDraftGroup(
  drafts: CatalogTemplateDraft[],
  fromGroup: string,
  toGroup: string
): CatalogTemplateDraft[] {
  const trimmed = toGroup.trim();
  if (!trimmed || trimmed === fromGroup) return drafts;
  return drafts.map((d) => (d.group === fromGroup ? { ...d, group: trimmed } : d));
}
