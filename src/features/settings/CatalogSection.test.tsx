// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CatalogItem } from '@/domain/types';
import { formatINR } from '@/domain/money';

let catalogItems: CatalogItem[] = [];
/** serviceCatalogId -> visit count, consulted only for inactive items. */
let usageCounts: Record<string, number> = {};
const put = vi.fn().mockResolvedValue(undefined);
const hardDelete = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services', () => ({
  repos: {
    catalog: { list: () => catalogItems, put: (item: unknown) => put(item) },
    visits: { countByService: (id: string) => usageCounts[id] ?? 0 },
  },
  catalogService: { hardDelete: (id: string) => hardDelete(id) },
}));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
// The real useLiveQuery resolves its querier asynchronously against the
// live Dexie table; calling the querier directly keeps these tests
// synchronous and independent of the real local DB, as long as the mocked
// repo methods above return plain values rather than promises.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));

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
  hardDelete.mockClear();
  catalogItems = [];
  usageCounts = {};
});

describe('ServiceCatalog — active vs. inactive separation', () => {
  it('keeps active items in their group and inactive ones in their own collapsed section, with no redundant badge', async () => {
    catalogItems = [
      item({ name: 'Active Service' }),
      item({ name: 'Retired Service', active: false }),
    ];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    expect(await screen.findByText('Active Service')).toBeInTheDocument();
    // The Inactive services section starts collapsed.
    expect(screen.queryByText('Retired Service')).not.toBeInTheDocument();

    const expand = screen.getByRole('button', { name: 'Expand inactive services' });
    fireEvent.click(expand);
    expect(await screen.findByText('Retired Service')).toBeInTheDocument();
    // No "Inactive" badge on the row — the section header already says so.
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
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

    expect(await screen.findByText('No active services match "nonexistent".')).toBeInTheDocument();
  });
});

describe('ServiceCatalogItemRow — live per-session preview', () => {
  it('shows a live per-session price while editing a package, updating as the price changes', async () => {
    catalogItems = [item({ name: 'Physio Package', sessionCount: 5, basePricePaise: 450000 })];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);

    const editBtn = await screen.findByRole('button', { name: 'Edit' });
    fireEvent.click(editBtn);
    expect(
      await screen.findByText(`${formatINR(90000)} per session, across 5 sessions`)
    ).toBeInTheDocument();

    // Not getByLabelText: the hint text sits inside the same <label> as the
    // input, so the label's full text includes it, breaking exact-text
    // label matching. The starting value (₹4,500) is unique on the page.
    const priceInput = screen.getByDisplayValue('4500');
    fireEvent.change(priceInput, { target: { value: '5000' } }); // ₹5,000 total / 5 sessions
    expect(
      await screen.findByText(`${formatINR(100000)} per session, across 5 sessions`)
    ).toBeInTheDocument();
  });

  it('shows no per-session preview for a single-session service', async () => {
    catalogItems = [item({ name: 'Initial Consultation', sessionCount: 1, basePricePaise: 50000 })];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);

    const editBtn = await screen.findByRole('button', { name: 'Edit' });
    fireEvent.click(editBtn);
    expect(screen.queryByText(/per session/)).not.toBeInTheDocument();
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

describe('ServiceCatalogItemRow — hard delete', () => {
  it('offers Delete for an inactive item with zero usage, and calls catalogService.hardDelete on confirm', async () => {
    const retired = item({ name: 'Retired Service', active: false });
    catalogItems = [retired];
    usageCounts = { [retired.id]: 0 };
    render(<CatalogSection view="packages" onViewChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand inactive services' }));
    const deleteBtn = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(deleteBtn);

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(hardDelete).toHaveBeenCalledWith(retired.id);
  });

  it('shows a usage note instead of Delete for an inactive item with existing visits', async () => {
    const retired = item({ name: 'Retired Service', active: false });
    catalogItems = [retired];
    usageCounts = { [retired.id]: 12 };
    render(<CatalogSection view="packages" onViewChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand inactive services' }));
    expect(await screen.findByText("Used on 12 visits — can't delete")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
