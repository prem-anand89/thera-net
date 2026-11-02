// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Clinic } from '@/domain/types';

const clinicRef: { current: Partial<Clinic> } = { current: {} };
const put = vi.fn(async (row: Partial<Clinic>) => {
  clinicRef.current = row;
});
const recompute = vi.fn(async () => ({ updated: 3 }));
const count = vi.fn(async (_clinicId: string, _settings: unknown) => 0);

vi.mock('@/app/clinicContext', () => ({ useClinic: () => clinicRef.current }));
vi.mock('@/services', () => ({
  repos: { clinics: { get: async () => clinicRef.current, put: (row: Partial<Clinic>) => put(row) } },
  visitService: {
    recomputeUninvoicedSplits: () => recompute(),
    countUninvoicedSplitChanges: (clinicId: string, settings: unknown) => count(clinicId, settings),
  },
}));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => null, publicLogoUrl: () => null }));

import { PartnerSection, partnerSplitChanged } from './BillingSections';
import { PLAN_TIER_LABELS, minimumTierFor } from '@/domain/plans';

const base: Partial<Clinic> = {
  id: 'c1',
  name: 'Physio Clinic',
  hasPartner: false,
  partnerCollects: false,
  partnerHospitalName: null,
  clinicSplitPct: 60,
  taxPct: 0,
  tdsBasis: 'gross_bill',
};

beforeEach(() => {
  clinicRef.current = { ...base };
  put.mockClear();
  recompute.mockReset();
  recompute.mockImplementation(async () => ({ updated: 3 }));
  count.mockReset();
  count.mockImplementation(async () => 0);
});
afterEach(cleanup);

describe('partnerSplitChanged', () => {
  it('turning partner mode on or off, or changing the split, tax or TDS basis, moves the split', () => {
    const b = { hasPartner: true, clinicSplitPct: 60, taxPct: 10, tdsBasis: 'gross_bill' as const };
    expect(partnerSplitChanged(b, { ...b })).toBe(false);
    expect(partnerSplitChanged(b, { ...b, hasPartner: false })).toBe(true);
    expect(partnerSplitChanged(b, { ...b, clinicSplitPct: 55 })).toBe(true);
    expect(partnerSplitChanged(b, { ...b, taxPct: 0 })).toBe(true);
    expect(partnerSplitChanged(b, { ...b, tdsBasis: 'clinic_share' })).toBe(true);
    expect(partnerSplitChanged({ ...b, hasPartner: undefined }, { ...b, hasPartner: false })).toBe(false);
  });
});

describe('PartnerSection below the plan that includes the partner split', () => {
  it('still shows the card, with the switch disabled and the plan that has it', () => {
    render(<PartnerSection onDirtyChange={vi.fn()} allowed={false} />);
    expect(screen.getByRole('switch', { name: 'We work with a partner' })).toBeDisabled();
    expect(screen.getByText(new RegExp(`Available on the ${PLAN_TIER_LABELS[minimumTierFor('revenueSplit')]} plan`))).toBeInTheDocument();
  });

  it('a clinic that still has partner mode on can turn it off, which re-applies the split', async () => {
    clinicRef.current = { ...base, hasPartner: true, partnerCollects: true, partnerHospitalName: 'City Hospital' };
    render(<PartnerSection onDirtyChange={vi.fn()} allowed={false} />);
    expect(screen.getByText(/Partner mode is still on for this clinic \(City Hospital\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off partner mode' }));
    await waitFor(() => expect(recompute).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ hasPartner: false, partnerCollects: false });
  });
});

describe('PartnerSection on a plan with the partner split', () => {
  it('shows the card with partner mode off, and no partner fields until it is turned on', () => {
    render(<PartnerSection onDirtyChange={vi.fn()} allowed />);
    expect(screen.getByRole('switch', { name: 'We work with a partner' })).not.toBeChecked();
    expect(screen.queryByLabelText('Partner name')).toBeNull();
  });

  it('turning partner mode on shows every partner setting, and saving re-applies the split', async () => {
    render(<PartnerSection onDirtyChange={vi.fn()} allowed />);
    fireEvent.click(screen.getByRole('switch', { name: 'We work with a partner' }));
    expect(screen.getByLabelText('Partner name')).toBeInTheDocument();
    expect(screen.getByText('Who collects patient payments?')).toBeInTheDocument();
    expect(screen.getByText(/Your share %/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Partner name'), { target: { value: 'City Hospital' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(recompute).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ hasPartner: true, partnerHospitalName: 'City Hospital' });
  });

  it('keeps the report column names and the TDS basis under More options, closed unless already customised', () => {
    clinicRef.current = { ...base, hasPartner: true, partnerHospitalName: 'City Hospital', taxPct: 10 };
    render(<PartnerSection onDirtyChange={vi.fn()} allowed />);
    expect(screen.queryByText(/Your share label/)).toBeNull();
    expect(screen.queryByText('TDS basis')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByText(/Your share label/)).toBeInTheDocument();
    expect(screen.getByText(/Partner share label/)).toBeInTheDocument();
    expect(screen.getByText('TDS basis')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fewer options' }));
    expect(screen.queryByText(/Your share label/)).toBeNull();
  });

  it('More options opens by itself when a label or the TDS basis has been customised', () => {
    clinicRef.current = { ...base, hasPartner: true, partnerShareLabel: 'Hospital', taxPct: 10 };
    render(<PartnerSection onDirtyChange={vi.fn()} allowed />);
    expect(screen.getByText(/Partner share label/)).toBeInTheDocument();
  });

  it('with no tax %, More options holds only the report column names', () => {
    clinicRef.current = { ...base, hasPartner: true, partnerHospitalName: 'City Hospital', taxPct: 0 };
    render(<PartnerSection onDirtyChange={vi.fn()} allowed />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByText(/Your share label/)).toBeInTheDocument();
    expect(screen.queryByText('TDS basis')).toBeNull();
  });

  it('renaming the partner alone saves without re-applying the split', async () => {
    clinicRef.current = { ...base, hasPartner: true, partnerHospitalName: 'City Hospital' };
    render(<PartnerSection onDirtyChange={vi.fn()} allowed />);
    fireEvent.change(screen.getByLabelText('Partner name'), { target: { value: 'City Hospital Group' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(recompute).not.toHaveBeenCalled();
  });

  it('renaming the partner never counts visits or asks', async () => {
    clinicRef.current = { ...base, hasPartner: true, partnerHospitalName: 'City Hospital' };
    render(<PartnerSection onDirtyChange={vi.fn()} allowed />);
    fireEvent.change(screen.getByLabelText('Partner name'), { target: { value: 'City Hospital Group' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(count).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('PartnerSection asks before it rewrites visits not yet invoiced', () => {
  it('a split change that touches visits asks with the number, counted against the unsaved settings', async () => {
    count.mockImplementation(async () => 4);
    clinicRef.current = { ...base, hasPartner: true, partnerHospitalName: 'City Hospital' };
    render(<PartnerSection onDirtyChange={vi.fn()} allowed />);
    fireEvent.change(screen.getByRole('spinbutton', { name: /Your share %/ }), { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'This recalculates 4 visits that have no invoice yet. Invoices already issued stay as they are.'
    );
    expect(count).toHaveBeenCalledWith('c1', expect.objectContaining({ hasPartner: true, clinicSplitPct: 55 }));
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save and update' }));
    await waitFor(() => expect(recompute).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ clinicSplitPct: 55 });
  });

  it('Cancel in the dialog saves nothing', async () => {
    count.mockImplementation(async () => 1);
    render(<PartnerSection onDirtyChange={vi.fn()} allowed />);
    fireEvent.click(screen.getByRole('switch', { name: 'We work with a partner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('This recalculates 1 visit that has no invoice yet.');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(put).not.toHaveBeenCalled();
    expect(recompute).not.toHaveBeenCalled();
  });

  it('turning partner mode off from a lower plan asks too when visits change', async () => {
    count.mockImplementation(async () => 2);
    clinicRef.current = { ...base, hasPartner: true, partnerHospitalName: 'City Hospital' };
    render(<PartnerSection onDirtyChange={vi.fn()} allowed={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off partner mode' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('This recalculates 2 visits');
    expect(count).toHaveBeenCalledWith('c1', expect.objectContaining({ hasPartner: false }));
    expect(put).not.toHaveBeenCalled();
  });

  it('if updating the visits fails after the save, it says so and offers to try again', async () => {
    recompute.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    render(<PartnerSection onDirtyChange={vi.fn()} allowed />);
    fireEvent.click(screen.getByRole('switch', { name: 'We work with a partner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Settings saved, but visits not yet invoiced were not updated/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update visits again' }));
    await waitFor(() => expect(recompute).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Applied the new split to 3/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update visits again' })).toBeNull();
  });
});
