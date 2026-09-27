import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useClinic } from '@/app/clinicContext';
import { useClinicRole } from '@/app/useClinicRole';
import { useSession } from '@/app/useSession';
import { repos } from '@/services';
import { syncEngine } from '@/sync/engine';
import { toFriendlyMessage } from '@/lib/errors';
import { btnPrimary, ErrorNote } from '@/components/ui';
import {
  clampOnboardingStep,
  hasPasswordIdentity,
  type OnboardingWizardStep,
} from '@/domain/onboarding';
import { OnboardingProgress } from './OnboardingProgress';
import { OnboardingTeamStep } from './OnboardingTeamStep';
import { OnboardingPasswordStep } from './OnboardingPasswordStep';
import { ServiceCatalogTemplateEditor } from './ServiceCatalogTemplateEditor';
import {
  catalogDraftsReadyToSave,
  createStarterCatalogDrafts,
  type CatalogTemplateDraft,
} from '@/domain/onboardingCatalogTemplates';
import type { CatalogItem } from '@/domain/types';
import {
  clearOnboardingWizardStorage,
  isPasswordNudgeSkipped,
  loadCatalogDrafts,
  markPasswordNudgeSkipped,
  saveCatalogDrafts,
  setOnboardingWizardPhase,
  getOnboardingWizardPhase,
} from './onboardingDraftStorage';

export type { OnboardingWizardStep };

export function OnboardingPage({ step }: { step: OnboardingWizardStep }) {
  const clinic = useClinic();
  const { role, loading: roleLoading } = useClinicRole(clinic.id);
  const { session } = useSession();
  const navigate = useNavigate();
  const [catalogDrafts, setCatalogDrafts] = useState<CatalogTemplateDraft[]>(() =>
    loadCatalogDrafts(clinic.id) ?? createStarterCatalogDrafts()
  );
  const [finishBusy, setFinishBusy] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const phase = getOnboardingWizardPhase(clinic.id);
  const clampedStep = clampOnboardingStep(step, phase);

  useEffect(() => {
    if (roleLoading) return;
    if (role !== 'admin') {
      void navigate({ to: '/workspace', replace: true });
    }
  }, [role, roleLoading, navigate]);

  useEffect(() => {
    if (clampedStep !== step) {
      void navigate({ to: '/onboarding', search: { step: clampedStep }, replace: true });
    }
  }, [clampedStep, step, navigate]);

  useEffect(() => {
    saveCatalogDrafts(clinic.id, catalogDrafts);
  }, [clinic.id, catalogDrafts]);

  function goToCatalogStep() {
    setOnboardingWizardPhase(clinic.id, 'catalog');
    void navigate({ to: '/onboarding', search: { step: 3 } });
  }

  function goAfterTeamStep() {
    const needsPassword =
      session?.user &&
      !hasPasswordIdentity(session.user.identities) &&
      !isPasswordNudgeSkipped(clinic.id);
    if (needsPassword) {
      setOnboardingWizardPhase(clinic.id, 'password');
      void navigate({ to: '/onboarding', search: { step: 'password' } });
    } else {
      goToCatalogStep();
    }
  }

  async function finishOnboarding() {
    if (!catalogDraftsReadyToSave(catalogDrafts)) {
      setFinishError('Add a price to at least one included service or package.');
      return;
    }
    setFinishBusy(true);
    setFinishError(null);
    try {
      const now = new Date().toISOString();
      const toSave = catalogDrafts.filter(
        (d) => d.enabled && d.name.trim() && d.basePricePaise != null && d.basePricePaise > 0
      );
      for (const d of toSave) {
        const item: CatalogItem = {
          id: d.key,
          clinicId: clinic.id,
          category: d.group.trim(),
          name: d.name.trim(),
          sessionCount: Math.max(1, d.sessionCount),
          basePricePaise: d.basePricePaise!,
          active: true,
          updatedAt: now,
        };
        await repos.catalog.put(item);
      }
      await repos.clinics.put({
        ...clinic,
        onboardingCompletedAt: now,
        updatedAt: now,
      });
      clearOnboardingWizardStorage(clinic.id);
      void syncEngine.schedule(0);
      void navigate({ to: '/workspace' });
    } catch (e) {
      setFinishError(
        `${toFriendlyMessage(e)} If this mentions a missing column, apply the latest Supabase migrations first.`
      );
    } finally {
      setFinishBusy(false);
    }
  }

  const progressStep = clampedStep === 3 ? 3 : 2;

  if (roleLoading || role !== 'admin') {
    return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-lg">
      {clampedStep !== 'password' && <OnboardingProgress step={progressStep} />}
      {clampedStep === 2 && <OnboardingTeamStep onContinue={goAfterTeamStep} />}
      {clampedStep === 'password' && (
        <OnboardingPasswordStep
          onSkip={() => {
            markPasswordNudgeSkipped(clinic.id);
            goToCatalogStep();
          }}
          onDone={goToCatalogStep}
        />
      )}
      {clampedStep === 3 && (
        <div className="space-y-4">
          <div>
            <h1 className="font-display text-xl font-semibold text-[var(--ink)]">Services you bill for</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              We&apos;ve filled in common templates — edit group names, session counts, and prices. Uncheck
              anything you don&apos;t offer. You need at least one priced item to continue.
            </p>
          </div>
          <ServiceCatalogTemplateEditor drafts={catalogDrafts} onChange={setCatalogDrafts} />
          <ErrorNote message={finishError} />
          <button
            type="button"
            className={btnPrimary}
            disabled={finishBusy || !catalogDraftsReadyToSave(catalogDrafts)}
            onClick={() => void finishOnboarding()}
          >
            {finishBusy ? 'Saving…' : 'Finish setup → Workspace'}
          </button>
          <button
            type="button"
            className="text-sm font-semibold text-[var(--teal)]"
            onClick={() => {
              setOnboardingWizardPhase(clinic.id, 'team');
              void navigate({ to: '/onboarding', search: { step: 2 } });
            }}
          >
            ← Back to team
          </button>
        </div>
      )}
    </div>
  );
}
