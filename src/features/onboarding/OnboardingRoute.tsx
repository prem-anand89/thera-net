import { useSearch } from '@tanstack/react-router';
import { OnboardingPage, type OnboardingWizardStep } from './OnboardingPage';

function parseStep(raw: unknown): OnboardingWizardStep {
  if (raw === 3 || raw === '3') return 3;
  if (raw === 'password') return 'password';
  if (raw === 'done') return 'done';
  return 2;
}

export function OnboardingRoute() {
  const { step } = useSearch({ strict: false }) as { step?: unknown };
  return <OnboardingPage step={parseStep(step)} />;
}
