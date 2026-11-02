// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PLAN_TIER_LABELS, minimumTierFor } from '@/domain/plans';
import { LockedCard } from './settingsShared';

describe('LockedCard', () => {
  afterEach(cleanup);

  it('keeps the card, with its title and one line naming the plan that has the feature', () => {
    const { container } = render(<LockedCard id="settings-card-billing-invoicing" title="Invoicing" feature="invoicing" />);
    expect(screen.getByRole('heading', { name: 'Invoicing' })).toBeInTheDocument();
    expect(screen.getByText(`Available on the ${PLAN_TIER_LABELS[minimumTierFor('invoicing')]} plan and above.`)).toBeInTheDocument();
    // The anchor stays, so Settings search still lands on the card
    expect(container.querySelector('#settings-card-billing-invoicing')).not.toBeNull();
  });
});
