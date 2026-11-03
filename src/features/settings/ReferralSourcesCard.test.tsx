// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReferringSourceItem } from '@/domain/types';

let sources: ReferringSourceItem[] = [];
const put = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/supabase', () => ({ getSupabase: () => null }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
vi.mock('@/services', async () => {
  const { createCatalogService } = await import('@/services/catalogService');
  const repos = { referringSourceCatalog: { list: () => sources, put: (i: unknown) => put(i) } };
  return { repos, catalogService: createCatalogService(repos as never) };
});
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));

import { ReferralSourcesCard } from './ReferralSourcesCard';

const source = (over: Partial<ReferringSourceItem> = {}): ReferringSourceItem => ({
  id: over.name ?? 'Doctor referral',
  clinicId: 'c1',
  name: 'Doctor referral',
  detailLabel: 'Referring doctor',
  active: true,
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

afterEach(() => {
  cleanup();
  put.mockClear();
  sources = [];
});

const dialog = () => screen.getByRole('dialog');

describe('Referral sources (General)', () => {
  it('is a card anchored where old links land, with "+ Add" in the header and no count pills', () => {
    sources = [source(), source({ name: 'Walk-in', detailLabel: null })];
    const { container } = render(<ReferralSourcesCard />);
    expect(screen.getByRole('heading', { name: 'Referral sources' })).toBeInTheDocument();
    expect(container.querySelector('#settings-card-general-referrals')).not.toBeNull();
    expect(screen.getByRole('button', { name: '+ Add' })).toBeInTheDocument();
    expect(screen.getByText(/How patients found you\. Asked when you add a patient; feeds the Referral sources report\./)).toBeInTheDocument();
    expect(screen.queryByText(/with detail field/)).toBeNull();
  });

  it('one row per source, with its follow-up question under the name', () => {
    sources = [source(), source({ name: 'Walk-in', detailLabel: null })];
    render(<ReferralSourcesCard />);
    const row = screen.getByRole('button', { name: 'Edit Doctor referral' });
    expect(row).toHaveTextContent('Then asks: Referring doctor');
    expect(screen.getByRole('button', { name: 'Edit Walk-in' })).not.toHaveTextContent('Then asks');
  });

  it('hidden sources sit in a collapsed "Hidden (N)" footer', () => {
    sources = [source(), source({ name: 'Old ad', active: false, detailLabel: null })];
    render(<ReferralSourcesCard />);
    expect(screen.queryByRole('button', { name: 'Edit Old ad' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Hidden/ }));
    expect(screen.getByRole('button', { name: 'Edit Old ad' })).toBeInTheDocument();
  });
});

describe('Referral sources — the sheet', () => {
  it('"+ Add" adds a source with no follow-up question by default', async () => {
    render(<ReferralSourcesCard />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    expect(dialog()).toHaveAccessibleName('Add a source');
    fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Name' }), { target: { value: 'Instagram ad' } });
    expect(within(dialog()).getByRole('switch', { name: 'Ask a follow-up question' })).not.toBeChecked();
    expect(within(dialog()).queryByRole('textbox', { name: 'Question' })).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ name: 'Instagram ad', detailLabel: null, active: true });
  });

  it('a follow-up question needs its text; with it, it is saved as the detail label', async () => {
    render(<ReferralSourcesCard />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Name' }), { target: { value: 'Doctor referral' } });
    fireEvent.click(within(dialog()).getByRole('switch', { name: 'Ask a follow-up question' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Enter the question');
    expect(put).not.toHaveBeenCalled();
    fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Question' }), { target: { value: 'Referring doctor' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ detailLabel: 'Referring doctor' });
  });

  it('a row opens its sheet filled in; turning the follow-up off clears the detail label', async () => {
    sources = [source()];
    render(<ReferralSourcesCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Doctor referral' }));
    expect(dialog()).toHaveAccessibleName('Edit source');
    expect(within(dialog()).getByRole('switch', { name: 'Ask a follow-up question' })).toBeChecked();
    expect(within(dialog()).getByRole('textbox', { name: 'Question' })).toHaveValue('Referring doctor');
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    fireEvent.click(within(dialog()).getByRole('switch', { name: 'Ask a follow-up question' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ id: 'Doctor referral', detailLabel: null });
  });

  it('"Shown" off hides the source; a hidden one can be shown again from its row', async () => {
    sources = [source(), source({ name: 'Old ad', active: false, detailLabel: null })];
    render(<ReferralSourcesCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Doctor referral' }));
    fireEvent.click(within(dialog()).getByRole('switch', { name: 'Shown' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ id: 'Doctor referral', active: false });
    put.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Hidden/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Old ad' }));
    fireEvent.click(within(dialog()).getByRole('switch', { name: 'Shown' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ id: 'Old ad', active: true });
  });

  it('stops a name that exists, and offers a hidden one again instead of adding a second', async () => {
    sources = [source(), source({ name: 'Old ad', active: false, detailLabel: null })];
    render(<ReferralSourcesCard />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    const name = within(dialog()).getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'doctor referral' } });
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('You already have Doctor referral.');
    expect(within(dialog()).getByRole('button', { name: 'Add' })).toBeDisabled();
    fireEvent.change(name, { target: { value: 'old ad' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Show it again' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ id: 'Old ad', active: true });
  });
});
