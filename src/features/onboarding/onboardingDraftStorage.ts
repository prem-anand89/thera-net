import type { CatalogTemplateDraft } from '@/domain/onboardingCatalogTemplates';

const CATALOG_KEY = (clinicId: string) => `onboardingCatalogDraft:v1:${clinicId}`;
const PASSWORD_SKIP_KEY = (clinicId: string) => `onboardingPasswordSkipped:v1:${clinicId}`;

export function loadCatalogDrafts(clinicId: string): CatalogTemplateDraft[] | null {
  try {
    const raw = sessionStorage.getItem(CATALOG_KEY(clinicId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogTemplateDraft[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCatalogDrafts(clinicId: string, drafts: CatalogTemplateDraft[]) {
  try {
    sessionStorage.setItem(CATALOG_KEY(clinicId), JSON.stringify(drafts));
  } catch {
    /* quota / private mode — wizard still works for this session */
  }
}

export function clearCatalogDrafts(clinicId: string) {
  try {
    sessionStorage.removeItem(CATALOG_KEY(clinicId));
  } catch {
    /* ignore */
  }
}

export function isPasswordNudgeSkipped(clinicId: string): boolean {
  try {
    return sessionStorage.getItem(PASSWORD_SKIP_KEY(clinicId)) === '1';
  } catch {
    return false;
  }
}

export function markPasswordNudgeSkipped(clinicId: string) {
  try {
    sessionStorage.setItem(PASSWORD_SKIP_KEY(clinicId), '1');
  } catch {
    /* ignore */
  }
}
