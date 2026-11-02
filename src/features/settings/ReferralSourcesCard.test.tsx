// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReferringSourceItem } from '@/domain/types';

let sources: ReferringSourceItem[] = [];
vi.mock('@/services', () => ({
  repos: { referringSourceCatalog: { list: () => sources, put: vi.fn() } },
}));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));

import { ReferralSourcesCard } from './CatalogSection';

afterEach(() => {
  cleanup();
  sources = [];
});

const source = (over: Partial<ReferringSourceItem>): ReferringSourceItem => ({
  id: crypto.randomUUID(),
  clinicId: 'c1',
  name: 'Doctor referral',
  detailLabel: 'Referring doctor',
  active: true,
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('How patients found you (General)', () => {
  it('is a card on its own, titled for patients and anchored where old links land', () => {
    sources = [source({}), source({ name: 'Walk-in', detailLabel: null })];
    const { container } = render(<ReferralSourcesCard />);
    expect(screen.getByRole('heading', { name: 'How patients found you' })).toBeInTheDocument();
    expect(container.querySelector('#settings-card-general-referrals')).not.toBeNull();
    expect(screen.getByText(/Asked when you add a patient\. Feeds the Referral sources report\./)).toBeInTheDocument();
    expect(screen.getByText('Doctor referral')).toBeInTheDocument();
  });

  it('says Hide and Show, and shows how many are hidden, with no count pills', () => {
    sources = [source({}), source({ name: 'Old ad', active: false })];
    render(<ReferralSourcesCard />);
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Deactivate/ })).toBeNull();
    expect(screen.getByText('Show hidden (1)')).toBeInTheDocument();
    expect(screen.queryByText(/with detail field/)).toBeNull();
  });
});
