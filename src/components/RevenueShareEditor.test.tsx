// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Therapist, Visit, VisitCredit, VisitItem } from '@/domain/types';

const setShares = vi.fn();
const recalculateShares = vi.fn();
vi.mock('@/services', () => ({
  visitService: {
    setShares: (...a: unknown[]) => setShares(...a),
    recalculateShares: (...a: unknown[]) => recalculateShares(...a),
  },
}));

import { RevenueShareEditor } from './RevenueShareEditor';

const th = (id: string, name: string, extra: Partial<Therapist> = {}) =>
  ({ id, clinicId: 'c1', name, active: true, ...extra }) as Therapist;
const therapists = [th('p', 'Dr Raghavender'), th('s', 'Dr Sneha', { userId: 'u2' }), th('x', 'Dr Extra')];
const visit = (over: Partial<Visit> = {}) =>
  ({ id: 'v1', clinicId: 'c1', therapistId: 'p', actualBillPaise: 130000, creditsMode: 'auto', ...over }) as Visit;
const item = (id: string, price: number, over: Partial<VisitItem> = {}): VisitItem => ({
  id,
  clinicId: 'c1',
  visitId: 'v1',
  position: Number(id.slice(-1)),
  serviceCatalogId: id,
  serviceName: id,
  catalogPricePaise: price,
  pricePaise: price,
  assistingTherapistId: null,
  durationMinutes: null,
  isPackageLine: false,
  deleted: false,
  updatedAt: '',
  ...over,
});
const credit = (t: string, amount: number, over: Partial<VisitCredit> = {}): VisitCredit => ({
  id: `cr-${t}`,
  clinicId: 'c1',
  visitId: 'v1',
  therapistId: t,
  amountPaise: amount,
  deleted: false,
  updatedAt: '2026-10-22T10:00:00Z',
  ...over,
});

const items = [item('a1', 100000), item('b2', 30000, { assistingTherapistId: 's' })];
const credits = [credit('p', 100000), credit('s', 30000)];

function open(props: Partial<React.ComponentProps<typeof RevenueShareEditor>> = {}) {
  const onClose = vi.fn();
  render(
    <RevenueShareEditor visit={visit()} items={items} credits={credits} therapists={therapists} onClose={onClose} {...props} />
  );
  return onClose;
}

beforeEach(() => {
  setShares.mockReset().mockResolvedValue(undefined);
  recalculateShares.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('RevenueShareEditor', () => {
  it('lets the primary\'s amount be typed when there is one assistant: the assistant takes the rest', () => {
    open();
    fireEvent.change(screen.getByLabelText('Dr Raghavender share in rupees'), { target: { value: '1000' } });
    expect(screen.getByLabelText('Dr Sneha share in rupees')).toHaveValue(300);
  });

  it('with nobody shared yet, shows the picker directly (no "add" step)', () => {
    open({ credits: [credit('p', 130000)], items: [] });
    expect(screen.getByLabelText('Add a therapist')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add another therapist' })).toBeNull();
  });

  it('with exactly one other therapist, starts with them', () => {
    open({ credits: [credit('p', 130000)], items: [], therapists: therapists.slice(0, 2) });
    expect(screen.getByLabelText('Dr Sneha share in rupees')).toHaveValue(0);
    expect(screen.queryByLabelText('Add a therapist')).toBeNull();
  });

  it('shows Automatic only for a shared, untouched split; Edited once amounts are changed', () => {
    open();
    expect(screen.getByText('Automatic')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Dr Sneha share in rupees'), { target: { value: '500' } });
    expect(screen.queryByText('Automatic')).toBeNull();
    expect(screen.getByText('Edited · saves as set manually')).toBeInTheDocument();
  });

  it('shows no status chip when nobody is shared with', () => {
    open({ credits: [credit('p', 130000)], items: [] });
    expect(screen.queryByText('Automatic')).toBeNull();
    expect(screen.queryByText(/Edited/)).toBeNull();
  });

  it('previews what Reset to services will change before asking', () => {
    open({ visit: visit({ creditsMode: 'manual' }), credits: [credit('p', 80000), credit('s', 50000)] });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to services' }));
    expect(screen.getByText('Reset to the split from the services?')).toBeInTheDocument();
    expect(screen.getByText('₹800 → ₹1,000')).toBeInTheDocument();
    expect(screen.getByText('₹500 → ₹300')).toBeInTheDocument();
  });

  it('lists the services on the visit', () => {
    open();
    expect(screen.getByText('Services on this visit')).toBeInTheDocument();
  });

  it('editing % updates ₹ and the remainder', () => {
    open();
    expect(screen.getByText('Takes the rest')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Dr Sneha share in percent'), { target: { value: '50' } });
    expect(screen.getByLabelText('Dr Sneha share in rupees')).toHaveValue(650);
    expect(screen.getByLabelText('Dr Raghavender share in rupees')).toHaveValue(650); // the primary's remainder
  });

  it('saves the edited rows through setShares', () => {
    const onClose = open();
    fireEvent.change(screen.getByLabelText('Dr Sneha share in rupees'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(setShares).toHaveBeenCalledWith('v1', [
      { therapistId: 'p', amountPaise: 80000 },
      { therapistId: 's', amountPaise: 50000 },
    ]);
    return vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('refuses more than bill less package money and blocks Save', () => {
    const pkgItems = [item('a1', 80000), item('pk2', 50000, { isPackageLine: true })];
    open({ items: pkgItems, credits: [credit('p', 130000), credit('s', 0)] });
    expect(screen.getByText('Package money stays with Dr Raghavender: ₹500')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Dr Sneha share in rupees'), { target: { value: '900' } });
    expect(screen.getByRole('alert')).toHaveTextContent("A share can't be more than the bill (less package money).");
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows the recalculate banner only when manual shares fell behind the services', () => {
    open({ visit: visit({ creditsMode: 'manual' }), credits: [credit('p', 100000)] });
    expect(screen.getByText('Services changed. Update shares from services?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate from services' }));
    expect(recalculateShares).toHaveBeenCalledWith('v1');
  });

  it('has no banner when the shares still match, and shows who edited last', () => {
    open({
      visit: visit({ creditsMode: 'manual' }),
      credits: [credit('p', 100000), credit('s', 30000, { updatedBy: 'u2', updatedAt: '2026-10-23T09:30:00Z' })],
    });
    expect(screen.queryByText('Services changed. Update shares from services?')).toBeNull();
    expect(screen.getByText(/Last edited by Dr Sneha · /)).toBeInTheDocument();
  });

  it('adds a therapist from the picker', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '+ Add another therapist' }));
    fireEvent.change(screen.getByLabelText('Add a therapist'), { target: { value: 'x' } });
    expect(screen.getByLabelText('Dr Extra share in rupees')).toHaveValue(0);
  });

  it('shows the banner when a line was edited after the shares', () => {
    const later = [item('a1', 100000, { updatedAt: '2026-10-23T00:00:00Z' }), item('b2', 30000, { assistingTherapistId: 's' })];
    open({ visit: visit({ creditsMode: 'manual' }), items: later, credits });
    expect(screen.getByText('Services changed. Update shares from services?')).toBeInTheDocument();
  });

  it('Remove returns a share to the primary', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByLabelText('Dr Sneha share in rupees')).toBeNull();
    expect(screen.getAllByText('₹1,300')).toHaveLength(2); // the bill in the header and the primary's share
  });

  it('opens an old one-assistant split as two rows (40% not the old 25%)', () => {
    open({ visit: visit({ sharedTherapistId: 's', sharedPct: 40 }), items: [], credits: [] });
    expect(screen.getByLabelText('Dr Sneha share in percent')).toHaveValue(40);
    expect(screen.getByLabelText('Dr Sneha share in rupees')).toHaveValue(520);
  });

  it('after the bill changed while shares were manual, the primary takes the difference and Save works', () => {
    open({
      visit: visit({ creditsMode: 'manual', actualBillPaise: 100000 }),
      credits: [credit('p', 100000), credit('s', 30000)],
    });
    expect(screen.getByLabelText('Dr Raghavender share in rupees')).toHaveValue(700);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('when the bill dropped below the shares it says so and blocks Save', () => {
    open({
      visit: visit({ creditsMode: 'manual', actualBillPaise: 20000 }),
      credits: [credit('p', 100000), credit('s', 30000)],
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The bill is now lower than the shares. Recalculate from services or lower a share.'
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('stored rows missing the primary get a primary remainder row', () => {
    open({ credits: [credit('s', 30000)] });
    expect(screen.getByText('₹1,000')).toBeInTheDocument();
  });

  it('is a modal that closes on Escape and focuses the first field', () => {
    const onClose = open();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Dr Sneha share in rupees')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
