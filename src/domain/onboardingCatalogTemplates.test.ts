import { describe, expect, it } from 'vitest';
import {
  catalogDraftsReadyToSave,
  zeroCatalogDrafts,
  createStarterCatalogDrafts,
  groupCatalogDrafts,
} from './onboardingCatalogTemplates';

describe('onboardingCatalogTemplates', () => {
  it('starter template includes single-session and package rows without a hardcoded session count in the package name', () => {
    const drafts = createStarterCatalogDrafts();
    expect(drafts.some((d) => d.sessionCount === 1)).toBe(true);
    const pkg = drafts.find((d) => d.sessionCount > 1);
    expect(pkg?.name).toBe('Physiotherapy Package');
    expect(drafts.every((d) => d.enabled)).toBe(true);
  });

  it('groupCatalogDrafts preserves template and insertion order instead of sorting alphabetically', () => {
    const drafts = createStarterCatalogDrafts();
    const groups = groupCatalogDrafts(drafts);
    expect(groups.get('Consultation')?.map((d) => d.name)).toEqual([
      'Initial Consultation',
      'Follow-up Consultation',
    ]);
    expect(groups.get('Physiotherapy')?.map((d) => d.name)).toEqual([
      'Physiotherapy Session',
      'Physiotherapy Package',
      'Manual Therapy Session',
      'Exercise Therapy Session',
    ]);
  });

  it('starter groups are only Consultation and Physiotherapy: none is named after a treatment', () => {
    const groups = [...new Set(createStarterCatalogDrafts().map((d) => d.group))].sort();
    expect(groups).toEqual(['Consultation', 'Physiotherapy']);
    // Every group holds more than one row, so no one-item groups for new clinics.
    for (const g of groups) expect(createStarterCatalogDrafts().filter((d) => d.group === g).length).toBeGreaterThan(1);
  });

  it('requires at least one enabled priced row', () => {
    const drafts = createStarterCatalogDrafts().map((d) => ({
      ...d,
      basePricePaise: null as number | null,
    }));
    expect(catalogDraftsReadyToSave(drafts)).toBe(false);
    drafts[0].basePricePaise = 100;
    expect(catalogDraftsReadyToSave(drafts)).toBe(true);
  });

  it('accepts ₹0 as a price, for a clinic that does not charge patients', () => {
    const blank = createStarterCatalogDrafts().map((d) => ({ ...d, basePricePaise: null as number | null }));
    expect(catalogDraftsReadyToSave(zeroCatalogDrafts(blank))).toBe(true);
    expect(zeroCatalogDrafts(blank).every((d) => d.basePricePaise === 0)).toBe(true);
  });
});
