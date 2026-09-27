import { useSearch } from '@tanstack/react-router';
import { OnboardingPage } from './OnboardingPage';

export function OnboardingRoute() {
  const { step } = useSearch({ strict: false }) as { step?: number };
  const resolved: 2 | 3 = step === 3 ? 3 : 2;
  return <OnboardingPage step={resolved} />;
}
