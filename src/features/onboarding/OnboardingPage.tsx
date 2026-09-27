import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useClinic } from '@/app/clinicContext';
import { repos } from '@/services';
import { syncEngine } from '@/sync/engine';
import { toFriendlyMessage } from '@/lib/errors';
import { btnPrimary, ErrorNote } from '@/components/ui';
import { OnboardingProgress } from './OnboardingProgress';
import { OnboardingTeamStep } from './OnboardingTeamStep';
import { ServiceCatalogTemplateEditor } from './ServiceCatalogTemplateEditor';
import {
  catalogDraftsReadyToSave,
  createStarterCatalogDrafts,
  type CatalogTemplateDraft,
} from '@/domain/onboardingCatalogTemplates';
import type { CatalogItem } from '@/domain/types';

export function OnboardingPage({ step }: { step: 2 | 3 }) {
  const clinic = useClinic();
  const navigate = useNavigate();
  const [catalogDrafts, setCatalogDrafts] = useState<CatalogTemplateDraft[]>(() => createStarterCatalogDrafts());
  const [finishBusy, setFinishBusy] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

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
          id: crypto.randomUUID(),
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
      void syncEngine.schedule(0);
      void navigate({ to: '/workspace' });
    } catch (e) {
      setFinishError(toFriendlyMessage(e));
    } finally {
      setFinishBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <OnboardingProgress step={step} />
      {step === 2 && (
        <OnboardingTeamStep onContinue={() => void navigate({ to: '/onboarding', search: { step: 3 } })} />
      )}
      {step === 3 && (
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
            onClick={() => void navigate({ to: '/onboarding', search: { step: 2 } })}
          >
            ← Back to team
          </button>
        </div>
      )}
    </div>
  );
}
