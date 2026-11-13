import { describe, expect, it } from 'vitest';
import {
  catalogDraftsReadyToSave,
  zeroCatalogDrafts,
  createStarterCatalogDrafts,
  groupCatalogDrafts,
  STARTER_CATALOG_TEMPLATE,
  createBlankStarterCatalogDrafts,
  hasPositivePricedDraft,
  catalogItemsFromDrafts,
  servicesReadyToStart,
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

describe('onboarding services (priced above 0)', () => {
  const blank = () => createBlankStarterCatalogDrafts();
  const withPrice = (idx: number, price: number | null, enabled = true) => {
    const d = blank();
    d[idx] = { ...d[idx], basePricePaise: price, enabled };
    return d;
  };
  it('blank drafts have the template length and no prices', () => {
    const d = blank();
    expect(d).toHaveLength(STARTER_CATALOG_TEMPLATE.length);
    expect(d.every((r) => r.basePricePaise === null)).toBe(true);
  });
  it('hasPositivePricedDraft', () => {
    expect(hasPositivePricedDraft(blank())).toBe(false);
    expect(hasPositivePricedDraft(withPrice(0, 0))).toBe(false);
    expect(hasPositivePricedDraft(withPrice(0, 80000, false))).toBe(false);
    expect(hasPositivePricedDraft(withPrice(0, 80000))).toBe(true);
  });
  it('catalogItemsFromDrafts when charging keeps only rows above 0', () => {
    const d = blank();
    d[0] = { ...d[0], basePricePaise: 0 };
    d[1] = { ...d[1], basePricePaise: 30000, enabled: false };
    d[3] = { ...d[3], basePricePaise: 350000 };
    const items = catalogItemsFromDrafts('c1', d, 'now', true);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: d[3].key, clinicId: 'c1', basePricePaise: 350000, sessionCount: 5, active: true, updatedAt: 'now', category: 'Physiotherapy' });
  });
  it('catalogItemsFromDrafts when not charging keeps enabled named rows at 0', () => {
    const d = blank();
    d[1] = { ...d[1], enabled: false };
    d[2] = { ...d[2], name: '  ' };
    const items = catalogItemsFromDrafts('c1', d, 'now', false);
    expect(items).toHaveLength(STARTER_CATALOG_TEMPLATE.length - 2);
    expect(items.every((i) => i.basePricePaise === 0)).toBe(true);
  });
  it('servicesReadyToStart', () => {
    expect(servicesReadyToStart(blank(), false)).toBe(true);
    expect(servicesReadyToStart(blank(), true)).toBe(false);
  });
});
