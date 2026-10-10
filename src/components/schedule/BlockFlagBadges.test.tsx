// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { BlockFlagBadges } from './BlockFlagBadges';
import type { PatientFlag } from '@/domain/patientFlags';

describe('BlockFlagBadges', () => {
  it('renders nothing for no flags', () => {
    const { container } = render(<BlockFlagBadges flags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('caps at two dots even with more flags', () => {
    const flags: PatientFlag[] = [
      { key: 'new', label: 'New patient' },
      { key: 'package', label: 'Package 1/6' },
      { key: 'balance', label: 'Balance due' },
    ];
    const { container } = render(<BlockFlagBadges flags={flags} />);
    expect(container.querySelectorAll('[class*="rounded-full"][class*="h-1.5"]')).toHaveLength(2);
  });

  it('renders the correct color class per flag key', () => {
    const flags: PatientFlag[] = [
      { key: 'balance', label: 'Balance due' },
      { key: 'noshow', label: '3 missed/cancelled', count: 3 },
    ];
    const { container } = render(<BlockFlagBadges flags={flags} />);
    const dots = container.querySelectorAll('[class*="h-1.5"]');
    expect(dots[0]).toHaveClass('bg-[var(--amber)]');
    expect(dots[1]).toHaveClass('bg-[var(--rust)]');
  });
});
