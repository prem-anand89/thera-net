import { useSearch } from '@tanstack/react-router';
import { OnboardingPage, type OnboardingWizardStep } from './OnboardingPage';

function parseStep(raw: unknown): OnboardingWizardStep {
  if (raw === 3 || raw === '3') return 3;
  if (raw === 'password') return 'password';
  return 2;
}

export function OnboardingRoute() {
  const { step } = useSearch({ strict: false }) as { step?: unknown };
  return <OnboardingPage step={parseStep(step)} />;
}
