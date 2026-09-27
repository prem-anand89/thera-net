import { describe, expect, it } from 'vitest';
import {
  catalogDraftsReadyToSave,
  createStarterCatalogDrafts,
  renameCatalogDraftGroup,
} from './onboardingCatalogTemplates';

describe('onboardingCatalogTemplates', () => {
  it('starter template includes single-session and package rows', () => {
    const drafts = createStarterCatalogDrafts();
    expect(drafts.some((d) => d.sessionCount === 1)).toBe(true);
    expect(drafts.some((d) => d.sessionCount > 1)).toBe(true);
    expect(drafts.every((d) => d.enabled)).toBe(true);
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

  it('renames group on all drafts in that group', () => {
    const drafts = createStarterCatalogDrafts();
    const next = renameCatalogDraftGroup(drafts, 'Consultation', 'Consult');
    expect(next.filter((d) => d.group === 'Consult').length).toBe(2);
  });
});
