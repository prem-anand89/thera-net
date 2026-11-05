// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TreatmentItem } from '@/domain/types';

let treatments: TreatmentItem[] = [];
let usage: { treatmentId: string; count: number }[] = [];
const put = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/supabase', () => ({ getSupabase: () => null }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
vi.mock('@/services', async () => {
  const { createCatalogService } = await import('@/services/catalogService');
  const repos = { treatmentCatalog: { list: () => treatments, put: (i: unknown) => put(i) } };
  return {
    repos,
    catalogService: createCatalogService(repos as never),
    dashboardService: { treatmentUsageCounts: () => usage },
  };
});
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));

import { TreatmentCatalog } from './TreatmentsView';

const t = (name: string, over: Partial<TreatmentItem> = {}): TreatmentItem => ({
  id: name,
  clinicId: 'c1',
  name,
  active: true,
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

afterEach(() => {
  cleanup();
  put.mockClear();
  treatments = [];
  usage = [];
  window.localStorage.clear();
});

const dialog = () => screen.getByRole('dialog');
const chipNames = () => screen.getAllByRole('button', { name: /^Edit / }).map((b) => b.getAttribute('aria-label')!.replace('Edit ', ''));

describe('Treatments — chips', () => {
  it('is a card titled "Treatments" with "+ Add" in the header, the hint, and no add box or count pills', () => {
    treatments = [t('Manual Therapy')];
    render(<TreatmentCatalog />);
    expect(screen.getByRole('heading', { name: 'Treatments' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add' })).toBeInTheDocument();
    expect(screen.getByText(/Tap a treatment to rename or hide it\./)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Treatment name')).toBeNull();
    expect(screen.queryByText(/^\d+ (total|active)$/)).toBeNull();
  });

  it('puts the most used first (alphabetical for ties), and shows counts unless "Show usage" is switched off', () => {
    treatments = [t('Dry Needling'), t('Exercise'), t('Manual Therapy'), t('Taping')];
    usage = [{ treatmentId: 'Manual Therapy', count: 312 }, { treatmentId: 'Exercise', count: 280 }];
    render(<TreatmentCatalog />);
    expect(chipNames()).toEqual(['Manual Therapy', 'Exercise', 'Dry Needling', 'Taping']);
    expect(screen.getByText('312')).toBeInTheDocument();
    expect(screen.getByText(/Counts are visits in the last 90 days\./)).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Show usage' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(screen.queryByText('312')).toBeNull();
    // The choice survives a reload.
    cleanup();
    render(<TreatmentCatalog />);
    expect(screen.getByRole('switch', { name: 'Show usage' })).not.toBeChecked();
  });

  it('hidden treatments sit in a collapsed "Inactive (N)" footer', () => {
    treatments = [t('Shown'), t('Old', { active: false })];
    render(<TreatmentCatalog />);
    expect(chipNames()).toEqual(['Shown']);
    fireEvent.click(screen.getByRole('button', { name: /Inactive/ }));
    expect(chipNames()).toEqual(['Shown', 'Old']);
  });
});

describe('Treatments — the sheet', () => {
  it('"+ Add" opens a sheet that adds a treatment, with the name box focused', async () => {
    treatments = [t('Manual Therapy')];
    render(<TreatmentCatalog />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    expect(dialog()).toHaveAccessibleName('Add a treatment');
    const name = within(dialog()).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: '  Cupping ' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ name: 'Cupping', active: true, clinicId: 'c1' });
  });

  it('Enter adds too', async () => {
    render(<TreatmentCatalog />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    const name = within(dialog()).getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'Cupping' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  });

  it('stops a name that exists (capitals ignored), offers a hidden one again, and only asks about a near one', async () => {
    const old = t('Matrix Rhythm', { active: false });
    treatments = [t('Manual Therapy'), old];
    render(<TreatmentCatalog />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    const name = within(dialog()).getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'manual therapy' } });
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('You already have Manual Therapy.');
    expect(within(dialog()).getByRole('button', { name: 'Add' })).toBeDisabled();
    fireEvent.change(name, { target: { value: 'Manual-Therapy' } });
    expect(within(dialog()).getByRole('status')).toHaveTextContent('Use that?');
    expect(within(dialog()).getByRole('button', { name: 'Add' })).not.toBeDisabled();
    fireEvent.change(name, { target: { value: 'matrix rhythm' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Make it active again' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ id: 'Matrix Rhythm', active: true });
  });

  it('tapping a chip opens it filled in; its own name raises no warning; rename saves', async () => {
    treatments = [t('Manual Therapy')];
    render(<TreatmentCatalog />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Manual Therapy' }));
    expect(dialog()).toHaveAccessibleName('Edit treatment');
    const name = within(dialog()).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('Manual Therapy');
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    fireEvent.change(name, { target: { value: 'Manual therapy (hands-on)' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ id: 'Manual Therapy', name: 'Manual therapy (hands-on)', active: true });
  });

  it('turning "Active" off hides the treatment, and a hidden one can be shown again from its chip', async () => {
    treatments = [t('Taping'), t('Old', { active: false })];
    render(<TreatmentCatalog />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Taping' }));
    fireEvent.click(within(dialog()).getByRole('switch', { name: 'Active' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ id: 'Taping', active: false });
    put.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Inactive/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Old' }));
    expect(within(dialog()).getByRole('switch', { name: 'Active' })).not.toBeChecked();
    fireEvent.click(within(dialog()).getByRole('switch', { name: 'Active' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ id: 'Old', active: true });
  });

  it('refuses a blank name without writing', () => {
    render(<TreatmentCatalog />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Enter a name.');
    expect(put).not.toHaveBeenCalled();
  });
});
