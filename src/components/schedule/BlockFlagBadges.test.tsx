// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BlockFlagBadges, FlagLegend, showsFlagDots } from './BlockFlagBadges';
import type { PatientFlag } from '@/domain/patientFlags';

afterEach(cleanup);

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
    // Most urgent first: may-not-show before balance due.
    expect(dots[0]).toHaveClass('bg-[var(--rust)]');
    expect(dots[1]).toHaveClass('bg-[var(--amber)]');
  });
});

describe('BlockFlagBadges urgency and accessibility', () => {
  it('keeps the two most urgent of three flags, and names every flag for hover and screen readers', () => {
    const { container } = render(
      <BlockFlagBadges
        flags={[
          { key: 'new', label: 'New patient' },
          { key: 'package', label: 'Package 2/6' },
          { key: 'balance', label: 'Balance due' },
        ]}
      />
    );
    const dots = container.querySelectorAll('[aria-hidden]');
    expect(dots).toHaveLength(2);
    expect(dots[0]).toHaveClass('bg-[var(--amber)]');
    expect(dots[1]).toHaveClass('bg-[var(--teal)]');
    expect(screen.getByText('New patient, Package 2/6, Balance due')).toBeInTheDocument();
  });
});

describe('showsFlagDots', () => {
  it('shows while the appointment is still to be seen', () => {
    expect(showsFlagDots({ status: 'confirmed', visitId: null })).toBe(true);
    expect(showsFlagDots({ status: 'arrived', visitId: null })).toBe(true);
  });
  it('hides once the visit is logged, or the slot was cancelled or missed', () => {
    expect(showsFlagDots({ status: 'arrived', visitId: 'v1' })).toBe(false);
    expect(showsFlagDots({ status: 'cancelled', visitId: null })).toBe(false);
    expect(showsFlagDots({ status: 'no_show', visitId: null })).toBe(false);
  });
});

describe('FlagLegend', () => {
  it('explains each dot colour', () => {
    render(<FlagLegend />);
    for (const label of ['New patient', 'Open package', 'Balance due', 'May not show']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
