import type { CatalogTemplateDraft } from '@/domain/onboardingCatalogTemplates';
import type { OnboardingWizardPhase } from '@/domain/onboarding';

const CATALOG_KEY = (clinicId: string) => `onboardingCatalogDraft:v1:${clinicId}`;
const PASSWORD_SKIP_KEY = (clinicId: string) => `onboardingPasswordSkipped:v1:${clinicId}`;
const PHASE_KEY = (clinicId: string) => `onboardingWizardPhase:v1:${clinicId}`;

function wizardKey(clinicId: string, keyFn: (id: string) => string): string {
  return keyFn(clinicId);
}

/** Prefer localStorage (survives tab close); one-time migrate from sessionStorage. */
function readWizardItem(clinicId: string, keyFn: (id: string) => string): string | null {
  const key = wizardKey(clinicId, keyFn);
  try {
    const fromLocal = localStorage.getItem(key);
    if (fromLocal != null) return fromLocal;
    const fromSession = sessionStorage.getItem(key);
    if (fromSession != null) {
      localStorage.setItem(key, fromSession);
      sessionStorage.removeItem(key);
      return fromSession;
    }
  } catch {
    /* private mode / quota */
  }
  return null;
}

function writeWizardItem(clinicId: string, keyFn: (id: string) => string, value: string) {
  const key = wizardKey(clinicId, keyFn);
  try {
    localStorage.setItem(key, value);
    sessionStorage.removeItem(key);
  } catch {
    /* quota / private mode — wizard still works for this session in memory */
  }
}

function removeWizardItem(clinicId: string, keyFn: (id: string) => string) {
  const key = wizardKey(clinicId, keyFn);
  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadCatalogDrafts(clinicId: string): CatalogTemplateDraft[] | null {
  try {
    const raw = readWizardItem(clinicId, CATALOG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogTemplateDraft[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCatalogDrafts(clinicId: string, drafts: CatalogTemplateDraft[]) {
  try {
    writeWizardItem(clinicId, CATALOG_KEY, JSON.stringify(drafts));
  } catch {
    /* quota / private mode */
  }
}

export function clearOnboardingWizardStorage(clinicId: string) {
  removeWizardItem(clinicId, CATALOG_KEY);
  removeWizardItem(clinicId, PASSWORD_SKIP_KEY);
  removeWizardItem(clinicId, PHASE_KEY);
}

export function isPasswordNudgeSkipped(clinicId: string): boolean {
  return readWizardItem(clinicId, PASSWORD_SKIP_KEY) === '1';
}

export function markPasswordNudgeSkipped(clinicId: string) {
  writeWizardItem(clinicId, PASSWORD_SKIP_KEY, '1');
}

export function getOnboardingWizardPhase(clinicId: string): OnboardingWizardPhase {
  const raw = readWizardItem(clinicId, PHASE_KEY);
  if (raw === 'password' || raw === 'catalog' || raw === 'done') return raw;
  return 'team';
}

export function setOnboardingWizardPhase(clinicId: string, phase: OnboardingWizardPhase) {
  writeWizardItem(clinicId, PHASE_KEY, phase);
}
