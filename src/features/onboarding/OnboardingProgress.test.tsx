// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OnboardingProgress } from './OnboardingProgress';

afterEach(cleanup);

describe('OnboardingProgress on phones', () => {
  it('shows the current step name always and the others only from sm:', () => {
    render(<OnboardingProgress step={3} />);
    expect(screen.getByText('Services')).not.toHaveClass('hidden');
    for (const other of ['Clinic', 'Team', 'Done']) {
      expect(screen.getByText(other)).toHaveClass('hidden', 'sm:inline');
    }
  });

  it('gives the current step the wider slot so its name is not cut ("Serv…")', () => {
    render(<OnboardingProgress step={3} />);
    const items = screen.getAllByRole('listitem');
    expect(items[2]).toHaveClass('flex-[2.2]', 'sm:flex-1');
    expect(items[0]).toHaveClass('flex-1');
  });

  it('keeps one font weight per state', () => {
    render(<OnboardingProgress step={1} />);
    const cls = screen.getByText('Clinic').className;
    expect(cls).toContain('font-semibold');
    expect(cls).not.toContain('font-medium');
  });
});
