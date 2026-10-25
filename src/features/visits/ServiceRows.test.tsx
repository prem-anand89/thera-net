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
    expect(screen.getByText('Session 5 of 10 · package (₹0)')).toBeInTheDocument();
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
      screen.getByText("Rahul has an open package (session 5 of 10). It isn't used on this visit.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add package session' }));
    expect(seen.at(-1)!.some((r) => r.continuation?.packageGroupId === 'g1')).toBe(true);
    expect(screen.queryByText(/isn't used on this visit/)).toBeNull();
  });

  it('guardrail shows when the package row is removed', () => {
    render(<Harness initial={[pkgRow(), row('b', 'assess')]} openPackages={[pkg]} />);
    expect(screen.queryByText(/isn't used on this visit/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Rehab package' }));
    expect(screen.getByText(/isn't used on this visit/)).toBeInTheDocument();
  });

  it('"Done by" starts as the visit therapist and lists active therapists only', () => {
    render(<Harness initial={[row('a', 'assess')]} />);
    fireEvent.click(screen.getByRole('button', { name: /Done by: Dr Raghavender/ }));
    fireEvent.focus(screen.getByRole('combobox', { name: 'Done by' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Dr Raghavender', 'Dr Sneha']);
  });

  it('"Done by" tags only that row, and choosing the visit therapist clears it', () => {
    const seen: DraftLine[][] = [];
    render(<Harness initial={[row('a', 'assess'), row('b', 'needle')]} onRows={(r) => seen.push(r)} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Done by: Dr Raghavender/ })[1]);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Done by' }));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Dr Sneha' }));
    expect(seen.at(-1)!.map((r) => r.assistingTherapistId)).toEqual([null, 't2']);
    fireEvent.click(screen.getByRole('button', { name: /Done by: Dr Sneha/ }));
    fireEvent.focus(screen.getByRole('combobox', { name: 'Done by' }));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Dr Raghavender' }));
    expect(seen.at(-1)!.map((r) => r.assistingTherapistId)).toEqual([null, null]);
  });

  it('solo clinic shows no "Done by" or "Share"', () => {
    render(<Harness initial={[row('a', 'assess')]} showAssistant={false} />);
    expect(screen.queryByRole('button', { name: /Done by/ })).toBeNull();
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
    expect(screen.getByText('Back package: only one package per visit.')).toBeInTheDocument();
    expect(screen.queryByText('Rehab package: only one package per visit.')).toBeNull();
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
        errors={new Map([[1, 'Pick a service.']])}
      />
    );
    expect(screen.getByText('Pick a service.')).toBeInTheDocument();
  });

  it('escape cancels an opened change-service picker and "Done by" picker', () => {
    render(<Harness initial={[row('a', 'assess')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    expect(screen.getByRole('combobox', { name: 'Service' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Service' }), { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: 'Service' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Done by/ }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Done by' }), { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: 'Done by' })).toBeNull();
    expect(screen.getByRole('button', { name: /Done by/ })).toBeInTheDocument();
  });

  it('adds another service row', () => {
    const seen: DraftLine[][] = [];
    render(<Harness initial={[row('a', 'assess')]} onRows={(r) => seen.push(r)} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add another service' }));
    expect(seen.at(-1)).toHaveLength(2);
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
  it('phone save bar states the payment choice, handles Cancel, busy, and disabled states', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const onSummary = vi.fn();
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

    fireEvent.click(within(bar).getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();

    fireEvent.click(within(bar).getByText('₹1,300'));
    expect(onSummary).toHaveBeenCalled();
    expect(bar.className).toContain('sm:hidden');

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

    // Busy state: Save shows "Saving…", both buttons disabled
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
    expect(within(bar).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(within(bar).getByRole('button', { name: 'Cancel' })).toBeDisabled();
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
    expect(last[1]!.sessionShare).toEqual({ therapistId: 't2', pct: 50 });
  });

  it('previews the rupees on a paid row', () => {
    render(<Harness initial={[row('a', 'assess', { sessionShare: { therapistId: 't2', pct: 30 } })]} />);
    // Assessment is ₹800 in the test catalog: 30% = ₹240.
    expect(screen.getByText('≈ ₹240')).toBeInTheDocument();
    expect(screen.getByText(/% of this service/)).toBeInTheDocument();
  });

  it('edits the percentage and removes the share on a package row', () => {
    const onRows = vi.fn();
    render(<Harness initial={[{ ...pkgRow(), sessionShare: { therapistId: 't2', pct: 50 } }]} openPackages={[pkg]} onRows={onRows} />);
    expect(screen.getByText(/% of this session/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /Done by/ }));
    fireEvent.focus(screen.getByRole('combobox', { name: 'Done by' }));
    // The row's own "Shared with" select also lists Dr Sneha; take the picker's option.
    fireEvent.mouseDown(screen.getAllByRole('option', { name: 'Dr Sneha' }).find((o) => o.tagName !== 'OPTION')!);
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

  it('flags a percentage outside 1 to 99 on any row', () => {
    const rows = [row('a', 'assess', { sessionShare: { therapistId: 't2', pct: 0 } })];
    expect(rowProblems(rows, catalog).get(0)).toMatch(/1 to 99/);
  });
});
