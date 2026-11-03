// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { OnboardingWizardPhase } from '@/domain/onboarding';

let mockPhase: OnboardingWizardPhase = 'team';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => ({ id: 'c1', name: 'Test Clinic' }),
}));

vi.mock('@/app/useClinicRole', () => ({
  useClinicRole: () => ({ role: 'admin', loading: false }),
}));

vi.mock('@/app/useSession', () => ({
  useSession: () => ({ session: { user: { id: 'u1', identities: [] } } }),
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => [],
}));

vi.mock('@/services', () => ({
  catalogService: { addServices: vi.fn() },
  repos: { catalog: { list: () => [] } },
}));

vi.mock('./OnboardingProgress', () => ({
  OnboardingProgress: () => <div data-testid="onboarding-progress" />,
}));

vi.mock('./OnboardingTeamStep', () => ({
  OnboardingTeamStep: () => <div data-testid="onboarding-team-step" />,
}));

vi.mock('./OnboardingPasswordStep', () => ({
  OnboardingPasswordStep: () => <div data-testid="onboarding-password-step" />,
}));

vi.mock('./ServiceCatalogTemplateEditor', () => ({
  ServiceCatalogTemplateEditor: () => <div data-testid="service-catalog-editor" />,
}));

vi.mock('./onboardingDraftStorage', () => ({
  clearOnboardingWizardStorage: vi.fn(),
  getOnboardingWizardPhase: () => mockPhase,
  isPasswordNudgeSkipped: () => false,
  loadCatalogDrafts: () => [],
  markPasswordNudgeSkipped: vi.fn(),
  saveCatalogDrafts: vi.fn(),
  setOnboardingWizardPhase: vi.fn(),
}));

import { OnboardingPage } from './OnboardingPage';

describe('OnboardingPage layout', () => {
  beforeEach(() => {
    mockPhase = 'team';
  });
  afterEach(cleanup);

  it('renders Step 2 (Team) without outer card borders or padding and with tab:max-w-3xl', () => {
    mockPhase = 'team';
    const { container } = render(<OnboardingPage step={2} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveClass('tab:max-w-3xl');
    expect(wrapper).not.toHaveClass('border');
    expect(wrapper).not.toHaveClass('rounded-2xl');
    expect(wrapper).not.toHaveClass('bg-[var(--surface)]');
    expect(screen.getByTestId('onboarding-team-step')).toBeInTheDocument();
  });

  it('renders Step 3 (Services) in the standard bordered card container with max-w-xl', () => {
    mockPhase = 'catalog';
    const { container } = render(<OnboardingPage step={3} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveClass('max-w-xl', 'rounded-2xl', 'border', 'bg-[var(--surface)]', 'p-5', 'sm:p-8');
    expect(wrapper).not.toHaveClass('tab:max-w-3xl');
    expect(screen.getByText('Services you bill for')).toBeInTheDocument();
  });

  it('renders Done step in the standard bordered card container with max-w-xl', () => {
    mockPhase = 'done';
    const { container } = render(<OnboardingPage step="done" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveClass('max-w-xl', 'rounded-2xl', 'border', 'bg-[var(--surface)]', 'p-5', 'sm:p-8');
    expect(screen.getByText('You’re set up')).toBeInTheDocument();
  });
});
