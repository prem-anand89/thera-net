// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CatalogItem } from '@/domain/types';

let catalogItems: CatalogItem[] = [];
let visits: { id: string; serviceCatalogId?: string }[] = [];
let history: Record<string, number> = {};
const put = vi.fn().mockResolvedValue(undefined);
const bulkPut = vi.fn().mockResolvedValue(undefined);
const hardDelete = vi.fn().mockResolvedValue(undefined);

let clinicObj: { id: string; careLocations?: string[] } = { id: 'c1' };
vi.mock('@/lib/supabase', () => ({ getSupabase: () => null }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => clinicObj }));
// The real catalogService (name checks, group writes, usage counts) on mocked repos; only the online delete is stubbed.
vi.mock('@/services', async () => {
  const { createCatalogService } = await import('@/services/catalogService');
  const repos = {
    catalog: { list: () => catalogItems, put: (i: unknown) => put(i), bulkPut: (rows: unknown) => bulkPut(rows) },
    visits: { list: () => visits, countByService: (id: string) => history[id] ?? 0 },
    visitItems: { listByClinic: () => [] },
  };
  const real = createCatalogService(repos as never);
  return { repos, catalogService: { ...real, hardDelete: (id: string) => hardDelete(id) } };
});
// Sync values return at once; promises (usage counts) resolve into state, like the real hook.
vi.mock('dexie-react-hooks', async () => {
  const React = await import('react');
  return {
    useLiveQuery: (query: () => unknown, deps: unknown[] = []) => {
      const result = query();
      const [resolved, setResolved] = React.useState<unknown>(undefined);
      React.useEffect(() => {
        if (result instanceof Promise) void result.then(setResolved);
      }, deps); // eslint-disable-line react-hooks/exhaustive-deps
      return result instanceof Promise ? resolved : result;
    },
  };
});

import { ServicesView } from './ServicesView';

const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  id: crypto.randomUUID(),
  clinicId: 'c1',
  category: 'Consultation',
  name: 'Initial assessment',
  sessionCount: 1,
  basePricePaise: 100000,
  active: true,
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

afterEach(() => {
  cleanup();
  put.mockClear();
  bulkPut.mockClear();
  hardDelete.mockClear();
  catalogItems = [];
  visits = [];
  history = {};
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const dialog = () => screen.getByRole('dialog');

describe('Services list — phone', () => {
  it('shows a loading placeholder, not "No services yet", until the list has loaded', () => {
    catalogItems = undefined as unknown as CatalogItem[];
    render(<ServicesView />);
    expect(screen.getByRole('status', { name: 'Loading services' })).toBeInTheDocument();
    expect(screen.queryByText(/No services yet/)).not.toBeInTheDocument();
  });

  it('has "+ Add" in the header, calm rows, and usage unless "Show usage" is off', async () => {
    const a = item({ name: 'Follow-up', basePricePaise: 60000 });
    catalogItems = [a];
    visits = [{ id: 'v1', serviceCatalogId: a.id }, { id: 'v2', serviceCatalogId: a.id }];
    render(<ServicesView />);
    expect(screen.getByRole('heading', { name: 'Services and prices' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Follow-up, ₹600' })).toBeInTheDocument();
    expect(await screen.findByText('Used in 2 visits')).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Show usage' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(screen.queryByText('Used in 2 visits')).toBeNull();
  });

  it('shows the package line with a whole-rupee per-session price', () => {
    catalogItems = [item({ name: 'Package (3)', sessionCount: 3, basePricePaise: 500000, durationMinutes: 45 })];
    render(<ServicesView />);
    expect(screen.getByText('3 sessions · ₹1,667 each · 45 min')).toBeInTheDocument();
  });

  it('named groups first, then the ungrouped ones under "Other"; no headings when nothing is grouped', () => {
    catalogItems = [item({ name: 'Home visit', category: '' }), item({ name: 'Session', category: 'Physiotherapy' }), item({ name: 'Follow-up' })];
    const { unmount } = render(<ServicesView />);
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    const order = names.filter((n) => /^(Group |Other$|Edit )/.test(n ?? '') || n === 'Other');
    expect(order.map((n) => n!.replace(/: rename or remove$/, '').replace(/, ₹.*$/, ''))).toEqual([
      'Group Consultation',
      'Edit Follow-up',
      'Group Physiotherapy',
      'Edit Session',
      'Edit Home visit',
    ]);
    expect(screen.getByText('Other')).toBeInTheDocument();
    unmount();
    catalogItems = [item({ name: 'A', category: '' }), item({ name: 'B', category: '' })];
    render(<ServicesView />);
    expect(screen.queryByText('Other')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Group / })).toBeNull();
  });

  it('shows the search box only above 8 services', () => {
    catalogItems = Array.from({ length: 8 }, (_, i) => item({ name: `S${i}` }));
    const { unmount } = render(<ServicesView />);
    expect(screen.queryByRole('searchbox', { name: 'Search services' })).toBeNull();
    unmount();
    catalogItems = Array.from({ length: 9 }, (_, i) => item({ name: `S${i}` }));
    render(<ServicesView />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services' }), { target: { value: 's8' } });
    expect(screen.getByRole('button', { name: /^Edit S8/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit S1,/ })).toBeNull();
  });

  it('keeps stopped services in a collapsed "Inactive" footer that says which can be deleted, once the counts have loaded', async () => {
    catalogItems = [item(), item({ name: 'Old', active: false })];
    render(<ServicesView />);
    expect(screen.queryByRole('button', { name: /^Edit Old/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Inactive/ }));
    // Counts that haven't arrived are not zeros: no "Not used yet" until they have.
    expect(screen.getByRole('button', { name: /^Edit Old/ })).not.toHaveTextContent('Not used yet');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Edit Old/ })).toHaveTextContent('Not used yet · can be deleted'));
  });
});

describe('Add a service', () => {
  it('adds one visit from the header button', async () => {
    render(<ServicesView />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    expect(dialog()).toHaveAccessibleName('Add a service');
    fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Name' }), { target: { value: 'Follow-up' } });
    fireEvent.change(within(dialog()).getByRole('spinbutton', { name: 'Price' }), { target: { value: '600' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ name: 'Follow-up', sessionCount: 1, basePricePaise: 60000, category: '', active: true });
  });

  it('a package starts at 5 sessions, has quick 5 / 10, never goes below 2, and shows the rounded price each', async () => {
    catalogItems = [item({ category: 'Physiotherapy' })];
    render(<ServicesView />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add a service' }));
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Package' }));
    const count = () => dialog().querySelector('output')?.textContent;
    expect(count()).toBe('5');
    expect(within(dialog()).getByRole('button', { name: '5' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(dialog()).getByRole('button', { name: '10' }));
    expect(within(dialog()).getByRole('button', { name: '10' })).toHaveAttribute('aria-pressed', 'true');
    const fewer = within(dialog()).getByRole('button', { name: 'One fewer session' });
    expect(count()).toBe('10');
    for (let i = 0; i < 9; i++) fireEvent.click(fewer);
    expect(count()).toBe('2');
    expect(fewer).toBeDisabled();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'One more session' }));
    expect(count()).toBe('3');
    fireEvent.change(within(dialog()).getByRole('spinbutton', { name: 'Price for the whole package' }), { target: { value: '5000' } });
    expect(within(dialog()).getByText('₹1,667 each')).toBeInTheDocument();
    // Adding has nothing to reassure about: the line is for editing an existing price.
    expect(within(dialog()).queryByText(/Past visits, open packages and issued invoices stay as they were\./)).toBeNull();
    fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Name' }), { target: { value: 'Physio package (3)' } });
    fireEvent.change(within(dialog()).getByRole('combobox', { name: 'Group (optional)' }), { target: { value: 'Physiotherapy' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ sessionCount: 3, basePricePaise: 500000, category: 'Physiotherapy' });
  });

  it('stops a name that exists and offers a stopped one again', async () => {
    const stopped = item({ name: 'Dry Needling', active: false });
    catalogItems = [item(), stopped];
    render(<ServicesView />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    const name = within(dialog()).getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'initial assessment' } });
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('You already have Initial assessment.');
    expect(within(dialog()).getByRole('button', { name: 'Add' })).toBeDisabled();
    fireEvent.change(name, { target: { value: 'dry needling' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Make it active again' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ id: stopped.id, active: true });
  });

  it('session length is a plain optional field (no "More"): invalid minutes are refused, valid ones saved', async () => {
    render(<ServicesView />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Name' }), { target: { value: 'Assessment' } });
    fireEvent.change(within(dialog()).getByRole('spinbutton', { name: 'Price' }), { target: { value: '1000' } });
    expect(within(dialog()).queryByRole('button', { name: 'More' })).toBeNull();
    const length = within(dialog()).getByRole('spinbutton', { name: 'Session length (minutes, optional)' });
    fireEvent.change(length, { target: { value: '0' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add' }));
    expect(await within(dialog()).findByText(/Enter minutes between 1 and 480/)).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
    fireEvent.change(length, { target: { value: '45' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ durationMinutes: 45 });
  });
});

describe('Edit a service', () => {
  it('a row opens the same sheet filled in; usage is always shown there; its own name raises no warning', async () => {
    const a = item({ name: 'Follow-up', basePricePaise: 60000 });
    catalogItems = [a];
    visits = [{ id: 'v1', serviceCatalogId: a.id }];
    render(<ServicesView />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Follow-up, ₹600' }));
    expect(dialog()).toHaveAccessibleName('Edit service');
    expect(within(dialog()).getByRole('textbox', { name: 'Name' })).toHaveValue('Follow-up');
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    expect(await within(dialog()).findByText("Used in 1 visit, so it can't be deleted.")).toBeInTheDocument();
    fireEvent.change(within(dialog()).getByRole('spinbutton', { name: 'Price' }), { target: { value: '700' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ id: a.id, basePricePaise: 70000 });
  });

  it('offers Delete only for a stopped service with no history, behind a confirm', async () => {
    const unused = item({ name: 'Unused', active: false });
    const used = item({ name: 'Used', active: false });
    history = { [used.id]: 3 };
    catalogItems = [item(), unused, used];
    render(<ServicesView />);
    fireEvent.click(screen.getByRole('button', { name: /Inactive/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Edit Used,/ }));
    expect(within(dialog()).queryByRole('button', { name: 'Delete this service' })).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: /^Edit Unused,/ }));
    fireEvent.click(within(screen.getAllByRole('dialog')[0]).getByRole('button', { name: 'Delete this service' }));
    const confirm = screen.getAllByRole('dialog').find((d) => d.textContent?.includes('Delete this service?'))!;
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(hardDelete).toHaveBeenCalledWith(unused.id));
  });
});

describe('Groups', () => {
  it('a heading opens the group sheet; rename and remove are one write each; a blank name is refused', async () => {
    catalogItems = [item({ name: 'A' }), item({ name: 'B' })];
    render(<ServicesView />);
    fireEvent.click(screen.getByRole('button', { name: 'Group Consultation: rename or remove' }));
    expect(dialog()).toHaveAccessibleName('Group: Consultation');
    expect(within(dialog()).getByText('2 services. Renaming moves them all at once.')).toBeInTheDocument();
    const box = within(dialog()).getByRole('textbox', { name: 'Group name' });
    fireEvent.change(box, { target: { value: '  ' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Group name is required');
    fireEvent.change(box, { target: { value: 'Consult' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bulkPut).toHaveBeenCalledTimes(1));
    expect(bulkPut.mock.calls[0][0].map((i: CatalogItem) => i.category)).toEqual(['Consult', 'Consult']);
  });

  it('"Remove group (keeps the services)" ungroups them in one write', async () => {
    catalogItems = [item({ name: 'A' })];
    render(<ServicesView />);
    fireEvent.click(screen.getByRole('button', { name: 'Group Consultation: rename or remove' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove group (keeps the services)' }));
    await waitFor(() => expect(bulkPut).toHaveBeenCalledTimes(1));
    expect(bulkPut.mock.calls[0][0][0]).toMatchObject({ category: '' });
  });
});

describe('Package validity', () => {
  it('is on packages only, blank by default, offers 30/60/90, and refuses a bad number', async () => {
    catalogItems = [];
    render(<ServicesView />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    expect(within(dialog()).queryByLabelText(/Valid for/)).toBeNull();
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Package' }));
    const box = within(dialog()).getByLabelText(/Valid for/) as HTMLInputElement;
    expect(box.value).toBe('');
    fireEvent.click(within(dialog()).getByRole('button', { name: '60 days' }));
    expect(box.value).toBe('60');
    fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Name' }), { target: { value: 'Rehab' } });
    fireEvent.change(within(dialog()).getByRole('spinbutton', { name: 'Price for the whole package' }), { target: { value: '5000' } });
    fireEvent.change(box, { target: { value: '731' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^(Save|Add)/ }));
    expect(await within(dialog()).findByText(/whole number from 1 to 730/)).toBeInTheDocument();
  });

  it('editing says held packages keep their validity, and Save wakes on a change', () => {
    catalogItems = [item({ name: 'Package', sessionCount: 5, validityDays: 30 })];
    render(<ServicesView />);
    fireEvent.click(screen.getByRole('button', { name: /^Edit Package/ }));
    expect(within(dialog()).getByLabelText(/Valid for/)).toHaveValue(30);
    expect(within(dialog()).getByText(/Packages already bought keep what they started with/)).toBeInTheDocument();
    const save = within(dialog()).getByRole('button', { name: /^Save/ });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog()).getByLabelText(/Valid for/), { target: { value: '' } });
    expect(save).toBeEnabled();
  });
});

describe('Services list — desktop table', () => {
  it('shows columns, "—" for one-visit rows, and Used unless "Show usage" is off', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('min-width'), media: q, addEventListener() {}, removeEventListener() {} }));
    const pkg = item({ name: 'Package', sessionCount: 10, basePricePaise: 1000000 });
    catalogItems = [item(), pkg];
    visits = [{ id: 'v1', serviceCatalogId: pkg.id }];
    render(<ServicesView />);
    const table = screen.getByRole('table');
    // The Used column waits for the counts, so a table never shows zeros that are really "not loaded yet".
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Service', 'Sessions', 'Price', 'Each', 'Length', 'Edit']);
    await act(async () => {});
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Service', 'Sessions', 'Price', 'Each', 'Length', 'Used', 'Edit']);
    const row = within(table).getByRole('row', { name: 'Edit Package, ₹10,000' });
    expect(row).toHaveTextContent('10');
    expect(row).toHaveTextContent('₹1,000');
    expect(within(table).getByRole('row', { name: 'Edit Initial assessment, ₹1,000' })).toHaveTextContent('—');
    await act(async () => {});
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent)).toContain('Used');
    fireEvent.click(screen.getByRole('switch', { name: 'Show usage' }));
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent)).not.toContain('Used');
    fireEvent.keyDown(within(screen.getByRole('table')).getByRole('row', { name: 'Edit Package, ₹10,000' }), { key: 'Enter' });
    expect(dialog()).toHaveAccessibleName('Edit service');
  });
});

describe('Services list — review fixes', () => {
  it('a group heading and all its rows share one block, so the heading stays on screen for the whole group', () => {
    catalogItems = [item({ name: 'A' }), item({ name: 'B' }), item({ name: 'C' }), item({ name: 'Solo', category: 'Physio' })];
    render(<ServicesView />);
    const heading = screen.getByRole('button', { name: 'Group Consultation: rename or remove' });
    const block = heading.parentElement!;
    for (const n of ['A', 'B', 'C']) expect(within(block).getByRole('button', { name: new RegExp(`^Edit ${n},`) })).toBeInTheDocument();
    expect(within(block).queryByRole('button', { name: /^Edit Solo/ })).toBeNull();
  });

  it('the group sheet counts stopped services too, since a rename or remove moves them as well', () => {
    catalogItems = [item({ name: 'A' }), item({ name: 'Old', active: false })];
    render(<ServicesView />);
    fireEvent.click(screen.getByRole('button', { name: 'Group Consultation: rename or remove' }));
    expect(within(dialog()).getByText('2 services. Renaming moves them all at once.')).toBeInTheDocument();
  });

  it('opening a row does not focus the name box (no keyboard on a phone); adding does', () => {
    catalogItems = [item({ name: 'Follow-up' })];
    render(<ServicesView />);
    fireEvent.click(screen.getByRole('button', { name: /^Edit Follow-up/ }));
    expect(within(dialog()).getByRole('textbox', { name: 'Name' })).not.toHaveFocus();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    expect(within(dialog()).getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('a row\'s line under the name is its description, so a screen reader hears it', () => {
    catalogItems = [item({ name: 'Package', sessionCount: 10, basePricePaise: 1000000 })];
    render(<ServicesView />);
    expect(screen.getByRole('button', { name: 'Edit Package, ₹10,000' })).toHaveAccessibleDescription('10 sessions · ₹1,000 each');
  });

  it('says so when every service is stopped, instead of "No services yet"', () => {
    catalogItems = [item({ name: 'Old', active: false })];
    render(<ServicesView />);
    expect(screen.getByText(/No active services/)).toBeInTheDocument();
    expect(screen.queryByText(/No services yet/)).toBeNull();
  });
});

describe('Edit a service — form refinements', () => {
  const open = (it_: CatalogItem) => {
    catalogItems = [it_];
    render(<ServicesView />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Edit ${it_.name},`) }));
  };

  it('Save stays off until something changes, and the reassurance line shows only when editing', () => {
    open(item({ name: 'Follow-up', basePricePaise: 60000 }));
    expect(within(dialog()).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(within(dialog()).getByText(/Past visits, open packages and issued invoices stay as they were\./)).toBeInTheDocument();
    fireEvent.change(within(dialog()).getByRole('spinbutton', { name: 'Price' }), { target: { value: '700' } });
    expect(within(dialog()).getByRole('button', { name: 'Save' })).not.toBeDisabled();
    fireEvent.change(within(dialog()).getByRole('spinbutton', { name: 'Price' }), { target: { value: '600' } });
    expect(within(dialog()).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows what the price was once it is changed', () => {
    open(item({ name: 'Follow-up', basePricePaise: 60000 }));
    expect(within(dialog()).queryByText('Was ₹600')).toBeNull();
    fireEvent.change(within(dialog()).getByRole('spinbutton', { name: 'Price' }), { target: { value: '750' } });
    expect(within(dialog()).getByText('Was ₹600')).toBeInTheDocument();
  });

  it('warns when the session count of a used service changes: only later visits use it', async () => {
    const used = item({ name: 'Rehab', sessionCount: 5, basePricePaise: 500000 });
    visits = [{ id: 'v1', serviceCatalogId: used.id }];
    open(used);
    await within(dialog()).findByText(/Used in 1 visit/);
    expect(within(dialog()).queryByText(/Visits logged from now on/)).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'One more session' }));
    expect(within(dialog()).getByText(/Visits logged from now on/)).toHaveTextContent('Visits logged from now on use 6 sessions. Packages already started keep their own count.');
  });

  it('Enter in the name or price box saves, but not while Save is off', async () => {
    open(item({ name: 'Follow-up', basePricePaise: 60000 }));
    const name = within(dialog()).getByRole('textbox', { name: 'Name' });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(put).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: 'Follow-up visit' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ name: 'Follow-up visit' });
  });

  it('session length is saved from its own field, and can be cleared', async () => {
    open(item({ name: 'Assessment', durationMinutes: 45 }));
    const length = within(dialog()).getByRole('spinbutton', { name: 'Session length (minutes, optional)' });
    expect(length).toHaveValue(45);
    fireEvent.change(length, { target: { value: '' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ durationMinutes: null });
  });
});

describe('ServicesView - ServiceFormSheet departments', () => {
  it('shows department checkboxes when clinic has multiple departments and saves normalized departments', async () => {
    clinicObj = { id: 'c1', careLocations: ['clinic', 'home', 'ward'] };
    catalogItems = [];
    render(<ServicesView />);

    // Click "+ Add"
    fireEvent.click(screen.getByRole('button', { name: /\+ Add/i }));

    // Checkboxes should exist
    expect(screen.getByLabelText('OP')).toBeInTheDocument();
    expect(screen.getByLabelText('Home care')).toBeInTheDocument();
    expect(screen.getByLabelText('IP')).toBeInTheDocument();

    // Fill form
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Inpatient Physio' } });
    fireEvent.change(screen.getByLabelText(/Price/i), { target: { value: '1500' } });

    // Tick only IP
    fireEvent.click(screen.getByLabelText('IP'));

    // Save
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({
      name: 'Inpatient Physio',
      departments: ['ward'],
    });
  });

  it('does not show department checkboxes when clinic has only clinic (OP)', () => {
    clinicObj = { id: 'c1', careLocations: ['clinic'] };
    catalogItems = [];
    render(<ServicesView />);

    fireEvent.click(screen.getByRole('button', { name: /\+ Add/i }));
    expect(screen.queryByLabelText('OP')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('IP')).not.toBeInTheDocument();
  });
});

