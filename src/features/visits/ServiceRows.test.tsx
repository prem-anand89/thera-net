// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { CatalogItem, Therapist, VisitItem } from '@/domain/types';
import { ServiceRows, draftLinesToItems, draftSubtotalPaise, rowProblems, type DraftLine, type OpenPackage } from './ServiceRows';
import { RevenueShareSummary } from './RevenueShareSummary';
import { VisitSaveBar } from './VisitSaveBar';

afterEach(cleanup);

const item = (id: string, name: string, pricePaise: number, sessionCount = 1): CatalogItem => ({
  id,
  clinicId: 'c1',
  category: sessionCount > 1 ? 'Packages' : 'Services',
  name,
  sessionCount,
  basePricePaise: pricePaise,
  active: true,
  updatedAt: '2026-01-01T00:00:00Z',
});
const catalog = [
  item('assess', 'Assessment', 80000),
  item('needle', 'Dry needling', 50000),
  item('rehab', 'Rehab package', 500000, 10),
  item('pkg2', 'Back package', 300000, 6),
];
const therapist = (id: string, name: string, active = true): Therapist => ({ id, clinicId: 'c1', name, active }) as Therapist;
const therapists = [
  therapist('t1', 'Dr Raghavender'),
  therapist('t2', 'Dr Sneha'),
  therapist('t3', 'Dr Gone', false),
];
const pkg: OpenPackage = {
  packageGroupId: 'g1',
  serviceCatalogId: 'rehab',
  serviceName: 'Rehab package',
  logged: 4,
  packageTotal: 10,
  startedOn: '2026-09-01',
};

function Harness(props: {
  initial: DraftLine[];
  openPackages?: OpenPackage[];
  showAssistant?: boolean;
  quickServices?: CatalogItem[];
  onRows?: (rows: DraftLine[]) => void;
}) {
  const [rows, setRows] = useState(props.initial);
  return (
    <ServiceRows
      rows={rows}
      onChange={(next) => {
        setRows(next);
        props.onRows?.(next);
      }}
      catalog={catalog}
      openPackages={props.openPackages ?? []}
      therapists={therapists}
      primaryId="t1"
      showAssistant={props.showAssistant ?? true}
      errors={new Map()}
      patientName="Rahul"
      quickServices={props.quickServices}
    />
  );
}
const row = (key: string, serviceCatalogId?: string, extra: Partial<DraftLine> = {}): DraftLine => ({
  key,
  serviceCatalogId,
  assistingTherapistId: null,
  ...extra,
});
const pkgRow = (key = 'p'): DraftLine => ({ key, continuation: pkg, assistingTherapistId: null });

describe('ServiceRows', () => {
  it('one open package adds a continuation row that can be removed', () => {
    // the page adds the row; here we show it renders as the package row and removes with its x
    const seen: DraftLine[][] = [];
    render(<Harness initial={[pkgRow(), row('b', 'assess')]} openPackages={[pkg]} onRows={(r) => seen.push(r)} />);
    expect(screen.getByText('Package session 5 of 10 · ₹0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Rehab package' }));
    expect(seen.at(-1)!.map((r) => r.key)).toEqual(['b']);
  });

  it('a single row has no remove button', () => {
    render(<Harness initial={[row('a', 'assess')]} />);
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('removing the first promotes the next', () => {
    const seen: DraftLine[][] = [];
    render(<Harness initial={[row('a', 'assess'), row('b', 'needle')]} onRows={(r) => seen.push(r)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Assessment' }));
    expect(seen.at(-1)!.map((r) => r.serviceCatalogId)).toEqual(['needle']);
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('use a different service replaces the package row', () => {
    const seen: DraftLine[][] = [];
    render(<Harness initial={[pkgRow()]} openPackages={[pkg]} onRows={(r) => seen.push(r)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a different service' }));
    const after = seen.at(-1)!;
    expect(after).toHaveLength(1);
    expect(after[0].continuation).toBeUndefined();
    expect(after[0].serviceCatalogId).toBeUndefined();
    expect(screen.getByRole('combobox', { name: 'Service' })).toBeInTheDocument();
  });

  it('add package session restores it from the guardrail', () => {
    const seen: DraftLine[][] = [];
    render(<Harness initial={[row('a', 'assess')]} openPackages={[pkg]} onRows={(r) => seen.push(r)} />);
    expect(
      screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Open package: Rehab package — 6 sessions left (4 of 10 used).')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use a session for this visit (₹0)' }));
    expect(seen.at(-1)!.some((r) => r.continuation?.packageGroupId === 'g1')).toBe(true);
    expect(screen.queryByText(/Open package:/)).toBeNull();
  });

  it('guardrail shows when the package row is removed', () => {
    render(<Harness initial={[pkgRow(), row('b', 'assess')]} openPackages={[pkg]} />);
    expect(screen.queryByText(/Open package:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Rehab package' }));
    expect(screen.getByText(/Open package:/)).toBeInTheDocument();
  });

  it('"Done by" starts as the visit therapist and lists active therapists only', () => {
    render(<Harness initial={[row('a', 'assess')]} />);
    const trigger = screen.getByRole('button', { name: 'Done by: Dr Raghavender' });
    fireEvent.click(trigger);
    const list = screen.getByRole('listbox', { name: 'Who did this service' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent?.replace('✓', ''))).toEqual(['Dr Raghavender', 'Dr Sneha']);
    // The current choice is ticked.
    expect(within(list).getByRole('option', { name: /Dr Raghavender/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(list).getByRole('option', { name: /Dr Sneha/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('"Done by" tags only that row, and choosing the visit therapist clears it', () => {
    const seen: DraftLine[][] = [];
    render(<Harness initial={[row('a', 'assess'), row('b', 'needle')]} onRows={(r) => seen.push(r)} />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Done by:/ })[1]!);
    fireEvent.click(screen.getByRole('option', { name: /Dr Sneha/ }));
    expect(seen.at(-1)!.map((r) => r.assistingTherapistId)).toEqual([null, 't2']);
    fireEvent.click(screen.getAllByRole('button', { name: /^Done by:/ })[1]!);
    fireEvent.click(screen.getByRole('option', { name: /Dr Raghavender/ }));
    expect(seen.at(-1)!.map((r) => r.assistingTherapistId)).toEqual([null, null]);
  });

  it('solo clinic shows no "Done by" or "Share"', () => {
    render(<Harness initial={[row('a', 'assess')]} showAssistant={false} />);
    expect(screen.queryByRole('button', { name: /^Done by:/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });

  it('picker lists open packages before services', () => {
    render(<Harness initial={[row('a')]} openPackages={[pkg]} />);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Service' }));
    const opts = screen.getAllByRole('option').map((o) => o.textContent);
    expect(opts[0]).toBe('Continue: Rehab package — session 5 of 10 (₹0)');
    expect(opts.slice(1).some((o) => o!.startsWith('Assessment'))).toBe(true);
  });

  it('second package row shows an error naming the service', () => {
    render(<Harness initial={[pkgRow(), row('b', 'pkg2')]} openPackages={[pkg]} />);
    expect(screen.getByText('Only one package per visit — remove Back package or the other one.')).toBeInTheDocument();
    expect(screen.queryByText('Only one package per visit — remove Rehab package or the other one.')).toBeNull();
  });

  it('shows a row error passed in by the page on that row', () => {
    render(
      <ServiceRows
        rows={[row('a', 'assess'), row('b')]}
        onChange={vi.fn()}
        catalog={catalog}
        openPackages={[]}
        therapists={therapists}
        primaryId="t1"
        showAssistant
        errors={new Map([[1, 'Choose a service.']])}
      />
    );
    expect(screen.getByText('Choose a service.')).toBeInTheDocument();
  });

  it('escape cancels an opened change-service picker', () => {
    render(<Harness initial={[row('a', 'assess')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    expect(screen.getByRole('combobox', { name: 'Service' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Service' }), { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: 'Service' })).toBeNull();
  });

  it('Escape in an open service picker does not reach a dialog around the rows', () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Harness initial={[row('a', 'assess')]} />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Service' }), { key: 'Escape' });
    expect(outer).not.toHaveBeenCalled();
  });

  it('adds another service row', () => {
    const seen: DraftLine[][] = [];
    render(<Harness initial={[row('a', 'assess')]} onRows={(r) => seen.push(r)} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add another service' }));
    expect(seen.at(-1)).toHaveLength(2);
  });
});

describe('the add-service row', () => {
  it('has no "+ Add another service" while a row is still empty (that row is where the next service goes)', () => {
    render(<Harness initial={[row('a', 'assess'), { key: 'e', assistingTherapistId: null }]} />);
    expect(screen.queryByRole('button', { name: '+ Add another service' })).toBeNull();
  });

  it('puts "+ Add another service" and the quick adds on one row', () => {
    render(<Harness initial={[row('a', 'assess')]} quickServices={[catalog[1]]} />);
    const add = screen.getByRole('button', { name: '+ Add another service' });
    const quick = screen.getByRole('button', { name: /\+ Dry needling/ });
    expect(add.parentElement).toBe(quick.parentElement);
    expect(add.parentElement).toHaveAttribute('data-testid', 'quick-services');
  });
});

describe('draft helpers', () => {
  it('subtotal counts a continuation as zero', () => {
    expect(draftSubtotalPaise([pkgRow(), row('b', 'assess')], catalog)).toBe(80000);
  });
});

describe('RevenueShareSummary', () => {
  const names = new Map([
    ['t1', { name: 'Dr Raghavender' }],
    ['t2', { name: 'Dr Sneha' }],
  ]);
  const itemsFor = (rows: DraftLine[]): VisitItem[] => draftLinesToItems(rows, catalog);

  it('is read-only and hidden when split is off or no assistant', () => {
    const tagged = [row('a', 'assess'), row('b', 'needle', { assistingTherapistId: 't2' })];
    const { container, rerender } = render(
      <RevenueShareSummary items={itemsFor(tagged)} primaryId="t1" billPaise={130000} therapistsById={names} splitEnabled={false} />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <RevenueShareSummary items={itemsFor([row('a', 'assess')])} primaryId="t1" billPaise={80000} therapistsById={names} splitEnabled />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <RevenueShareSummary items={itemsFor(tagged)} primaryId="t1" billPaise={130000} therapistsById={names} splitEnabled />
    );
    expect(container.textContent).toContain('Dr Raghavender ₹800 (62%)');
    expect(container.textContent).toContain('Dr Sneha ₹500 (38%)');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    // no onEdit -> no Edit split button
    expect(screen.queryByRole('button', { name: 'Edit split' })).toBeNull();
  });

  it('shows Edit split when it can be edited, and the package note at zero', () => {
    const onEdit = vi.fn();
    const rows = [pkgRow(), row('b', 'needle', { assistingTherapistId: 't2' })];
    render(
      <RevenueShareSummary items={itemsFor(rows)} primaryId="t1" billPaise={50000} therapistsById={names} splitEnabled onEdit={onEdit} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit split' }));
    expect(onEdit).toHaveBeenCalled();
    expect(screen.getByText('Package sessions are credited through package attribution.')).toBeInTheDocument();
    expect(screen.getByText(/Dr Raghavender ₹0/)).toBeInTheDocument();
  });
});

describe('VisitSaveBar', () => {
  it('save bar states the payment choice, shows Cancel from tablet up only, and handles busy and disabled states', () => {
    const onSave = vi.fn();
    const onSummary = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <VisitSaveBar
        totalPaise={130000}
        serviceCount={2}
        payment={{ kind: 'now', methodLabel: 'UPI' }}
        busy={false}
        onSave={onSave}
        onCancel={onCancel}
        onSummaryClick={onSummary}
      />
    );
    const bar = screen.getByTestId('visit-save-bar');
    expect(within(bar).getByText('₹1,300')).toBeInTheDocument();
    expect(within(bar).getByText('2 services · UPI, collected now')).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole('button', { name: 'Save visit' }));
    expect(onSave).toHaveBeenCalled();

    // Cancel is for tablet and up (hidden below sm:); on a phone the page header's back arrow is the way out.
    const cancel = within(bar).getByRole('button', { name: 'Cancel' });
    expect(cancel.className).toContain('hidden');
    expect(cancel.className).toContain('sm:inline-flex');
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalled();

    fireEvent.click(within(bar).getByText('₹1,300'));
    expect(onSummary).toHaveBeenCalled();
    // One fixed bar at the bottom edge at every width, not a floating card.
    expect(bar.className).toContain('fixed');
    expect(bar.className).toContain('bottom-0');
    expect(bar.className).not.toContain('sm:hidden');

    // With no service: "No service yet" and Save is disabled
    rerender(
      <VisitSaveBar
        totalPaise={0}
        serviceCount={0}
        payment={{ kind: 'none' }}
        busy={false}
        onSave={onSave}
        onCancel={onCancel}
        onSummaryClick={onSummary}
      />
    );
    expect(within(bar).getByText('No service yet')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Save visit' })).toBeDisabled();

    // Later collection format
    rerender(
      <VisitSaveBar
        totalPaise={50000}
        serviceCount={1}
        payment={{ kind: 'later' }}
        busy={false}
        onSave={onSave}
        onCancel={onCancel}
        onSummaryClick={onSummary}
      />
    );
    expect(within(bar).getByText('₹500')).toBeInTheDocument();
    expect(within(bar).getByText('1 service · to collect later')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Save visit' })).not.toBeDisabled();

    // A free package session says so instead of showing a payment
    rerender(
      <VisitSaveBar totalPaise={0} serviceCount={1} payment={{ kind: 'none' }} busy={false} onSave={onSave} onCancel={onCancel} onSummaryClick={onSummary} />
    );
    expect(within(bar).getByText('1 service · no charge')).toBeInTheDocument();

    // Busy state: Save shows "Saving…" and is disabled
    rerender(
      <VisitSaveBar
        totalPaise={50000}
        serviceCount={1}
        payment={{ kind: 'later' }}
        busy={true}
        onSave={onSave}
        onCancel={onCancel}
        onSummaryClick={onSummary}
      />
    );
    // Quick-switch payment popover and itemized subtext
    const onQuickChange = vi.fn();
    rerender(
      <VisitSaveBar
        totalPaise={150000}
        serviceCount={2}
        payment={{ kind: 'now', methodLabel: 'UPI' }}
        busy={false}
        onSave={onSave}
        onCancel={onCancel}
        onSummaryClick={onSummary}
        subtext="2 services (Manual ₹1,500 + Advanced ₹2,000) · Exercise Therapy"
        onQuickChangePayment={onQuickChange}
      />
    );
    expect(within(bar).getByText('2 services (Manual ₹1,500 + Advanced ₹2,000) · Exercise Therapy')).toBeInTheDocument();
    const pill = within(bar).getByTestId('payment-quick-pill');
    fireEvent.click(pill);
    const popover = screen.getByTestId('payment-popover');
    expect(popover).toBeInTheDocument();
    fireEvent.click(within(popover).getByText('Cash (Collect now)'));
    expect(onQuickChange).toHaveBeenCalledWith('cash');
    expect(screen.queryByTestId('payment-popover')).toBeNull();
  });
});

describe('the Done by list', () => {
  it('opens a styled list, closes on Escape without losing the choice, and on a click outside', () => {
    render(<Harness initial={[row('a', 'assess')]} />);
    const trigger = screen.getByRole('button', { name: 'Done by: Dr Raghavender' });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Done by: Dr Raghavender' })).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('moves between people with the arrow keys and picks with Enter', () => {
    const seen: DraftLine[][] = [];
    render(<Harness initial={[row('a', 'assess')]} onRows={(r) => seen.push(r)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done by: Dr Raghavender' }));
    const first = screen.getByRole('option', { name: /Dr Raghavender/ });
    first.focus();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Dr Sneha/ })).toHaveFocus();
    fireEvent.click(document.activeElement as HTMLElement);
    expect(seen.at(-1)![0]!.assistingTherapistId).toBe('t2');
  });
});

describe('sharing a service', () => {
  it('offers "Share" on a paid row and a package row, seeding a colleague who is not the one doing it', () => {
    const onRows = vi.fn();
    render(<Harness initial={[pkgRow(), row('n', 'needle')]} openPackages={[pkg]} onRows={onRows} />);
    const pills = screen.getAllByRole('button', { name: 'Share' });
    expect(pills).toHaveLength(2);
    fireEvent.click(pills[1]!);
    const last = onRows.mock.calls.at(-1)![0] as DraftLine[];
    expect(last[1]!.sessionShare?.therapistId).toBe('t2');
    // The percentage is left for the therapist to enter.
    expect(Number.isNaN(last[1]!.sessionShare!.pct)).toBe(true);
  });

  it('previews the rupees on a paid row', () => {
    render(<Harness initial={[row('a', 'assess', { sessionShare: { therapistId: 't2', pct: 30 } })]} />);
    // Assessment is ₹800 in the test catalog: 30% = ₹240.
    expect(screen.getByText('≈ ₹240')).toBeInTheDocument();
    expect(screen.getByText(/Their share of this service/)).toBeInTheDocument();
  });

  it('edits the percentage and removes the share on a package row', () => {
    const onRows = vi.fn();
    render(<Harness initial={[{ ...pkgRow(), sessionShare: { therapistId: 't2', pct: 50 } }]} openPackages={[pkg]} onRows={onRows} />);
    expect(screen.getByText(/Their share of this session/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Percent of this service'), { target: { value: '30' } });
    expect((onRows.mock.calls.at(-1)![0] as DraftLine[])[0]!.sessionShare?.pct).toBe(30);
    fireEvent.click(screen.getByRole('button', { name: 'Remove share' }));
    expect((onRows.mock.calls.at(-1)![0] as DraftLine[])[0]!.sessionShare).toBeNull();
  });

  it('drops a share whose colleague is the one doing the service', () => {
    const onRows = vi.fn();
    // t1 is the visit's therapist, so cannot also be the one it is shared with.
    render(<Harness initial={[{ ...pkgRow(), sessionShare: { therapistId: 't1', pct: 50 } }]} openPackages={[pkg]} onRows={onRows} />);
    const last = onRows.mock.calls.at(-1)![0] as DraftLine[];
    expect(last[0]!.sessionShare).toBeNull();
  });

  it('clears the share when "Done by" becomes the shared colleague', () => {
    const onRows = vi.fn();
    render(<Harness initial={[row('a', 'assess', { sessionShare: { therapistId: 't2', pct: 30 } })]} onRows={onRows} />);
    fireEvent.click(screen.getByRole('button', { name: /^Done by:/ }));
    fireEvent.click(screen.getByRole('option', { name: /Dr Sneha/ }));
    const last = onRows.mock.calls.at(-1)![0] as DraftLine[];
    expect(last[0]!.assistingTherapistId).toBe('t2');
    expect(last[0]!.sessionShare).toBeNull();
  });

  it('says "Same as last session" until the share is edited', () => {
    const onRows = vi.fn();
    render(<Harness initial={[{ ...pkgRow(), sessionShare: { therapistId: 't2', pct: 30 }, sharePrefilled: true }]} openPackages={[pkg]} onRows={onRows} />);
    expect(screen.getByText(/Same as last session/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Percent of this service'), { target: { value: '40' } });
    expect(screen.queryByText(/Same as last session/)).toBeNull();
  });

  it('asks for the % while it is empty', () => {
    const rows = [row('a', 'assess', { sessionShare: { therapistId: 't2', pct: NaN } })];
    expect(rowProblems(rows, catalog).get(0)).toBe('Enter their share (1–99%).');
  });

  it('flags a percentage outside 1 to 99 on any row', () => {
    const rows = [row('a', 'assess', { sessionShare: { therapistId: 't2', pct: 0 } })];
    expect(rowProblems(rows, catalog).get(0)).toMatch(/1 to 99/);
  });

  it('renders quick service chips and clicking one fills an empty row', () => {
    const onRows = vi.fn();
    render(
      <Harness
        initial={[{ key: 'r1', assistingTherapistId: null }]}
        quickServices={[catalog[0], catalog[1]]}
        onRows={onRows}
      />
    );
    expect(screen.getByTestId('quick-services')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ Assessment/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ Dry needling/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /\+ Assessment/ }));
    const last = onRows.mock.calls.at(-1)![0] as DraftLine[];
    expect(last).toHaveLength(1);
    expect(last[0].serviceCatalogId).toBe('assess');
  });

  it('clicking quick service chip appends a new row if all rows are filled', () => {
    const onRows = vi.fn();
    render(
      <Harness
        initial={[row('r1', 'assess')]}
        quickServices={[catalog[0], catalog[1]]}
        onRows={onRows}
      />
    );
    // Assessment is already on form, so it shouldn't show in quick-services
    expect(screen.queryByRole('button', { name: /\+ Assessment/ })).toBeNull();
    // Dry needling should show
    const dryBtn = screen.getByRole('button', { name: /\+ Dry needling/ });
    expect(dryBtn).toBeInTheDocument();

    fireEvent.click(dryBtn);
    const last = onRows.mock.calls.at(-1)![0] as DraftLine[];
    expect(last).toHaveLength(2);
    expect(last[1].serviceCatalogId).toBe('needle');
  });

  describe('a new package bought while one is still open', () => {
    it('warns, and "Use the remaining session" swaps the row for the free continuation', () => {
      const onRows = vi.fn();
      render(<Harness initial={[row('r1', 'rehab')]} openPackages={[pkg]} onRows={onRows} />);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Rahul still has 6 sessions left on this package. This row starts a new one.');
      // The general "open package isn't used" notice is not shown twice.
      expect(screen.queryByText(/Open package:/)).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Use the remaining session' }));
      const last = onRows.mock.calls.at(-1)![0] as DraftLine[];
      expect(last[0].continuation?.packageGroupId).toBe('g1');
      expect(last[0].serviceCatalogId).toBeUndefined();
    });

    it('"Keep the new package" keeps the purchase and the warning goes away', () => {
      const onRows = vi.fn();
      render(<Harness initial={[row('r1', 'rehab')]} openPackages={[pkg]} onRows={onRows} />);
      fireEvent.click(screen.getByRole('button', { name: 'Keep the new package' }));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(onRows).not.toHaveBeenCalled();
    });

    it('does not warn for a different package service, or for a single-session service', () => {
      render(<Harness initial={[row('r1', 'pkg2'), row('r2', 'assess')]} openPackages={[pkg]} />);
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('a share just added shows no error until its % box is left, or Save reveals it', () => {
    const { unmount } = render(<Harness initial={[row('r1', 'assess')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.queryByText('Enter their share (1–99%).')).toBeNull();
    fireEvent.blur(screen.getByLabelText('Percent of this service'));
    expect(screen.getByText('Enter their share (1–99%).')).toBeInTheDocument();
    unmount();

    render(
      <ServiceRows
        rows={[row('r1', 'assess', { sessionShare: { therapistId: 't2', pct: NaN } })]}
        onChange={() => {}}
        catalog={catalog}
        openPackages={[]}
        therapists={therapists}
        primaryId="t1"
        showAssistant
        errors={new Map()}
        revealProblems
      />
    );
    expect(screen.getByText('Enter their share (1–99%).')).toBeInTheDocument();
  });

  it('quick-add skips free services and a package that is already open', () => {
    const free = item('free', 'Complimentary Session', 0);
    render(
      <Harness
        initial={[{ key: 'r1', assistingTherapistId: null }]}
        openPackages={[pkg]}
        quickServices={[catalog[0], free, catalog[2]]}
      />
    );
    expect(screen.getByRole('button', { name: /\+ Assessment/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Complimentary/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /\+ Rehab package/ })).toBeNull();
  });

  it('the share row keeps the dropdown, the % box and remove together, with the result underneath', () => {
    render(<Harness initial={[row('r1', 'assess', { sessionShare: { therapistId: 't2', pct: 20 } })]} />);
    const who = screen.getByRole('button', { name: 'Shared with: Dr Sneha' });
    const pct = screen.getByLabelText('Percent of this service');
    const remove = screen.getByRole('button', { name: 'Remove share' });
    // One flex line holds all three controls; the label and the result are separate full-width lines.
    const line = who.parentElement?.parentElement?.parentElement;
    expect(pct.parentElement?.parentElement).toBe(line);
    expect(remove.parentElement).toBe(line);
    expect(who).toHaveTextContent('Dr Sneha');
    expect(screen.getByText(/Their share of this service/)).toHaveTextContent('≈ ₹160');
  });

  it('renders multiple package chips when patient has 2+ open packages and none is on form', () => {
    const pkg2: OpenPackage = {
      packageGroupId: 'g2',
      serviceCatalogId: 'pkg2',
      serviceName: 'Back package',
      logged: 1,
      packageTotal: 6,
      startedOn: '2026-09-10',
    };
    const onRows = vi.fn();
    render(
      <Harness
        initial={[{ key: 'r1', assistingTherapistId: null }]}
        openPackages={[pkg, pkg2]}
        onRows={onRows}
      />
    );
    const chipsContainer = screen.getByTestId('package-chips');
    expect(chipsContainer).toBeInTheDocument();
    expect(within(chipsContainer).getByRole('button', { name: /Rehab package/ })).toBeInTheDocument();
    expect(within(chipsContainer).getByRole('button', { name: /Back package/ })).toBeInTheDocument();

    fireEvent.click(within(chipsContainer).getByRole('button', { name: /Back package/ }));
    const last = onRows.mock.calls.at(-1)![0] as DraftLine[];
    expect(last).toHaveLength(1);
    expect(last[0].continuation?.packageGroupId).toBe('g2');
  });
});

