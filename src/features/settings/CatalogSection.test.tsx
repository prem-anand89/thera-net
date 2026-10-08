// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CatalogItem } from '@/domain/types';

let catalogItems: CatalogItem[] = [];
const put = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services', () => ({
  repos: { catalog: { list: async () => catalogItems, put: (item: unknown) => put(item) } },
}));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
// The real useLiveQuery resolves repos.catalog.list() asynchronously against
// the live Dexie table; mocking it to read catalogItems directly keeps these
// tests synchronous and independent of the real local DB.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => catalogItems }));

import { CatalogSection } from './CatalogSection';

const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  id: crypto.randomUUID(),
  clinicId: 'c1',
  category: 'Consultation',
  name: 'Initial Consultation',
  sessionCount: 1,
  basePricePaise: 50000,
  active: true,
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

afterEach(() => {
  cleanup();
  put.mockClear();
  catalogItems = [];
});

describe('ServiceCatalog — active badge', () => {
  it('does not badge an active item, only an inactive one', async () => {
    catalogItems = [
      item({ name: 'Active Service' }),
      item({ name: 'Retired Service', active: false }),
    ];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    // "Show inactive items" defaults to unchecked, so reveal the inactive row first.
    const checkbox = await screen.findByRole('checkbox', { name: 'Show inactive items' });
    fireEvent.click(checkbox);
    expect(await screen.findByText('Retired Service')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });
});

describe('ServiceCatalog — search', () => {
  it('filters items by name across categories', async () => {
    catalogItems = [
      item({ name: 'Initial Consultation', category: 'Consultation' }),
      item({ name: 'Deep Tissue Massage', category: 'Physiotherapy' }),
    ];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    expect(await screen.findByText('Initial Consultation')).toBeInTheDocument();
    expect(screen.getByText('Deep Tissue Massage')).toBeInTheDocument();

    const search = screen.getByPlaceholderText('Search services…');
    fireEvent.change(search, { target: { value: 'deep' } });

    expect(await screen.findByText('Deep Tissue Massage')).toBeInTheDocument();
    expect(screen.queryByText('Initial Consultation')).not.toBeInTheDocument();
  });

  it('shows a "no matches" message distinct from the empty-catalog message', async () => {
    catalogItems = [item({ name: 'Initial Consultation' })];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    await screen.findByText('Initial Consultation');

    const search = screen.getByPlaceholderText('Search services…');
    fireEvent.change(search, { target: { value: 'nonexistent' } });

    expect(await screen.findByText('No services match "nonexistent".')).toBeInTheDocument();
  });
});

describe('ServiceCatalog — collapsible categories', () => {
  it('hides a category\'s items once collapsed, and shows them again on expand', async () => {
    catalogItems = [item({ name: 'Initial Consultation', category: 'Consultation' })];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    expect(await screen.findByText('Initial Consultation')).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Collapse Consultation' });
    fireEvent.click(toggle);
    expect(screen.queryByText('Initial Consultation')).not.toBeInTheDocument();

    const expand = screen.getByRole('button', { name: 'Expand Consultation' });
    fireEvent.click(expand);
    expect(await screen.findByText('Initial Consultation')).toBeInTheDocument();
  });
});
