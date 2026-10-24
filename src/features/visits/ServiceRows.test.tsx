// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { CatalogItem, Therapist, VisitItem } from '@/domain/types';
import { ServiceRows, draftLinesToItems, draftSubtotalPaise, type DraftLine, type OpenPackage } from './ServiceRows';
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

  it("assistant list excludes the visit's therapist and inactive therapists", () => {
    render(<Harness initial={[row('a', 'assess')]} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Assign assistant' }));
    const box = screen.getByRole('combobox', { name: 'Assistant' });
    fireEvent.focus(box);
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(['Dr Sneha']);
  });

  it('assign assistant tags only that row', () => {
    const seen: DraftLine[][] = [];
    render(<Harness initial={[row('a', 'assess'), row('b', 'needle')]} onRows={(r) => seen.push(r)} />);
    fireEvent.click(screen.getAllByRole('button', { name: '+ Assign assistant' })[1]);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Assistant' }));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Dr Sneha' }));
    expect(seen.at(-1)!.map((r) => r.assistingTherapistId)).toEqual([null, 't2']);
    expect(screen.getByText('Dr Sneha · assisting')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove assistant Dr Sneha' }));
    expect(seen.at(-1)!.map((r) => r.assistingTherapistId)).toEqual([null, null]);
  });

  it('solo clinic shows no assign assistant', () => {
    render(<Harness initial={[row('a', 'assess')]} showAssistant={false} />);
    expect(screen.queryByRole('button', { name: '+ Assign assistant' })).toBeNull();
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

  it('escape cancels an opened change-service picker and assistant picker', () => {
    render(<Harness initial={[row('a', 'assess')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    expect(screen.getByRole('combobox', { name: 'Service' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Service' }), { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: 'Service' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Assign assistant' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Assistant' }), { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: 'Assistant' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ Assign assistant' })).toBeInTheDocument();
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
  it('phone save bar states the payment choice', () => {
    const onSave = vi.fn();
    const onSummary = vi.fn();
    const { rerender } = render(
      <VisitSaveBar totalPaise={130000} serviceCount={2} payment={{ kind: 'now', methodLabel: 'UPI' }} busy={false} onSave={onSave} onSummaryClick={onSummary} />
    );
    const bar = screen.getByTestId('visit-save-bar');
    expect(within(bar).getByText('₹1,300 · 2 services · UPI, collected now')).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Save visit' }));
    expect(onSave).toHaveBeenCalled();
    fireEvent.click(within(bar).getByText(/₹1,300/));
    expect(onSummary).toHaveBeenCalled();
    expect(bar.className).toContain('sm:hidden');
    rerender(
      <VisitSaveBar totalPaise={0} serviceCount={0} payment={{ kind: 'none' }} busy={false} onSave={onSave} onSummaryClick={onSummary} />
    );
    expect(within(bar).getByText('No service yet')).toBeInTheDocument();
    rerender(
      <VisitSaveBar totalPaise={50000} serviceCount={1} payment={{ kind: 'later' }} busy={false} onSave={onSave} onSummaryClick={onSummary} />
    );
    expect(within(bar).getByText('₹500 · 1 service · to collect later')).toBeInTheDocument();
  });
});

describe('sharing a package session', () => {
  it('offers "Share this session" only on a package row, and seeds a helper who is not the runner', () => {
    const onRows = vi.fn();
    render(<Harness initial={[pkgRow(), row('n', 'needle')]} openPackages={[pkg]} onRows={onRows} />);
    const links = screen.getAllByRole('button', { name: '+ Share this session' });
    expect(links).toHaveLength(1);
    fireEvent.click(links[0]!);
    const last = onRows.mock.calls.at(-1)![0] as DraftLine[];
    expect(last[0]!.sessionShare).toEqual({ therapistId: 't2', pct: 50 });
  });

  it('edits the percentage and removes the share', () => {
    const onRows = vi.fn();
    render(<Harness initial={[{ ...pkgRow(), sessionShare: { therapistId: 't2', pct: 50 } }]} openPackages={[pkg]} onRows={onRows} />);
    fireEvent.change(screen.getByLabelText('Percent of this session'), { target: { value: '30' } });
    expect((onRows.mock.calls.at(-1)![0] as DraftLine[])[0]!.sessionShare?.pct).toBe(30);
    fireEvent.click(screen.getByRole('button', { name: 'Remove session share' }));
    expect((onRows.mock.calls.at(-1)![0] as DraftLine[])[0]!.sessionShare).toBeNull();
  });

  it('drops a share whose helper is the person running the session', () => {
    const onRows = vi.fn();
    // t1 is the visit's therapist, so cannot also be the helper (e.g. the visit's therapist was just changed to t1).
    render(<Harness initial={[{ ...pkgRow(), sessionShare: { therapistId: 't1', pct: 50 } }]} openPackages={[pkg]} onRows={onRows} />);
    const last = onRows.mock.calls.at(-1)![0] as DraftLine[];
    expect(last[0]!.sessionShare).toBeNull();
  });

  it('shows no share control for a solo clinic', () => {
    render(<Harness initial={[pkgRow()]} openPackages={[pkg]} showAssistant={false} />);
    expect(screen.queryByRole('button', { name: '+ Share this session' })).toBeNull();
  });
});
