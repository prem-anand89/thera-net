// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CatalogItem } from '@/domain/types';
import { formatINR } from '@/domain/money';

let catalogItems: CatalogItem[] = [];
/** serviceCatalogId -> visit count, consulted only for inactive items. */
let usageCounts: Record<string, number> = {};
const put = vi.fn().mockResolvedValue(undefined);
const hardDelete = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/supabase', () => ({ getSupabase: () => null }));
// The real catalogService (so its name checks run) on top of the mocked repos; only the online-only delete is stubbed.
vi.mock('@/services', async () => {
  const { createCatalogService } = await import('@/services/catalogService');
  const repos = {
    catalog: { list: () => catalogItems, put: (item: unknown) => put(item) },
    visits: { countByService: (id: string) => usageCounts[id] ?? 0 },
  };
  const real = createCatalogService(repos as never);
  return { repos, catalogService: { ...real, hardDelete: (id: string) => hardDelete(id) } };
});
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
    // The "No longer offered" section starts collapsed.
    expect(screen.queryByText('Retired Service')).not.toBeInTheDocument();

    const expand = screen.getByRole('button', { name: 'Expand no longer offered' });
    fireEvent.click(expand);
    expect(await screen.findByText('Retired Service')).toBeInTheDocument();
    // No badge on the row — the section header already says so.
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Expand no longer offered' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Expand no longer offered' }));
    expect(await screen.findByText("Used on 12 visits — can't delete")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('ServiceCatalog — optional duration', () => {
  const openEdit = async (over: Partial<CatalogItem> = {}) => {
    catalogItems = [item({ name: 'Physio', ...over })];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  };
  const field = () => screen.getByLabelText(/Duration \(minutes, optional\)/);

  it('service form saves an optional duration and blank clears it', async () => {
    await openEdit({ durationMinutes: 20 });
    expect(screen.getByText('Per session for a package. Used for time reports; leave blank to count the whole session.')).toBeInTheDocument();
    expect(field()).toHaveValue(20);

    fireEvent.change(field(), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ durationMinutes: 45 });

    put.mockClear();
    // Saving closes the editor; reopen it to clear the value.
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ durationMinutes: null });
  });

  it.each(['0', '481', '2.5'])('rejects %s without saving', async (bad) => {
    await openEdit();
    fireEvent.change(field(), { target: { value: bad } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter minutes between 1 and 480, or leave it blank.')).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it('shows the duration in the row only when set', async () => {
    catalogItems = [item({ name: 'Timed', durationMinutes: 20 }), item({ name: 'Untimed' })];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    expect(await screen.findByText('· 20 min')).toBeInTheDocument();
    expect(screen.getAllByText(/ min$/)).toHaveLength(1);
  });
});

describe('Services & treatments tab — plain words', () => {
  it('switches between Services and Treatments, with no referral view and no count pills', () => {
    catalogItems = [item(), item({ name: 'Follow-up', category: 'Consultation' })];
    const onViewChange = vi.fn();
    render(<CatalogSection view="packages" onViewChange={onViewChange} />);
    expect(screen.getByRole('radio', { name: 'Services' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Treatments' })).not.toBeChecked();
    expect(screen.queryByRole('radio', { name: /Referral/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Treatments' }));
    expect(onViewChange).toHaveBeenCalledWith('treatments');
    expect(screen.queryByText(/single-session$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ (active|groups|packages|inactive)$/)).not.toBeInTheDocument();
  });

  it('titles the services card "Services and prices" and says where it shows up', () => {
    catalogItems = [item()];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Services and prices' })).toBeInTheDocument();
    expect(screen.getByText(/What patients pay for\. You pick these on a visit, and they print on bills and invoices\./)).toBeInTheDocument();
    expect(screen.getByText(/Record what you did in the session under Treatments\./)).toBeInTheDocument();
  });

  it('says "Stop offering" and "One visit", never "Deactivate" or "Single session"', () => {
    catalogItems = [item({ name: 'Solo visit' })];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Stop offering' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Deactivate/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('One visit').length).toBeGreaterThan(0);
    expect(screen.queryByText('Single session')).not.toBeInTheDocument();
  });

  it('shows a stopped service under "No longer offered (1)" with "Offer again"', () => {
    catalogItems = [item({ name: 'Old service', active: false })];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    expect(screen.getByRole('heading', { name: 'No longer offered' })).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand no longer offered' }));
    expect(screen.getByRole('button', { name: 'Offer again' })).toBeInTheDocument();
  });
});

describe('Services — name check as you type', () => {
  function openAdd() {
    fireEvent.click(screen.getByRole('button', { name: '+ One visit' }));
  }

  it('stops a name that already exists (capitals ignored) and keeps Add off', async () => {
    catalogItems = [item({ name: 'Initial Consultation' })];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    openAdd();
    fireEvent.change(screen.getByPlaceholderText('e.g. Follow-up consultation'), { target: { value: 'initial consultation' } });
    expect(screen.getByRole('alert')).toHaveTextContent('You already have Initial Consultation.');
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(put).not.toHaveBeenCalled();
  });

  it('offers a stopped service again instead of adding a second one', async () => {
    const stopped = item({ name: 'Dry Needling', active: false });
    catalogItems = [item(), stopped];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    openAdd();
    fireEvent.change(screen.getByPlaceholderText('e.g. Follow-up consultation'), { target: { value: 'dry needling' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Dry Needling is in No longer offered.');
    fireEvent.click(screen.getByRole('button', { name: 'Offer it again' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ id: stopped.id, active: true });
  });

  it('only asks about a near match, and still lets you add', async () => {
    catalogItems = [item({ name: 'Initial Consultation' })];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    openAdd();
    fireEvent.change(screen.getByPlaceholderText('e.g. Follow-up consultation'), { target: { value: 'Initial Consultations' } });
    expect(screen.getByRole('status')).toHaveTextContent('You already have Initial Consultation. Use that?');
    expect(screen.getByRole('button', { name: 'Add' })).not.toBeDisabled();
  });

  it('editing a service keeps its own name without a warning', () => {
    catalogItems = [item({ name: 'Initial Consultation' })];
    render(<CatalogSection view="packages" onViewChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });
});

