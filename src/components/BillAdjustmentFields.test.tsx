// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillAdjustmentFields, type BillAdjustmentFieldsProps } from './BillAdjustmentFields';
import { isNewVisitDirty, newVisitSignature } from '@/features/visits/NewVisitPage';

afterEach(cleanup);

function renderFields(props: Partial<BillAdjustmentFieldsProps> = {}) {
  const defaultProps: BillAdjustmentFieldsProps = {
    catalogPricePaise: 100000,
    catalogLabel: 'Subtotal',
    mode: 'none',
    valueType: 'amount',
    value: '',
    reason: '',
    onModeChange: vi.fn(),
    onValueTypeChange: vi.fn(),
    onValueChange: vi.fn(),
    onReasonChange: vi.fn(),
    totalLabel: 'Total',
    ...props,
  };
  return { ...render(<BillAdjustmentFields {...defaultProps} />), props: defaultProps };
}

describe('BillAdjustmentFields', () => {
  it('hideTotalWhenPlain hides the total box until there is a discount or extra to explain', () => {
    const { rerender, props } = renderFields({ hideTotalWhenPlain: true, mode: 'none' });
    expect(screen.getByText('Total: ₹1,000').parentElement).toHaveClass('hidden');

    rerender(
      <BillAdjustmentFields {...props} hideTotalWhenPlain mode="discount" valueType="amount" value="200" />
    );
    expect(screen.getByText('Total: ₹800').parentElement).not.toHaveClass('hidden');
  });

  it('is collapsed by default when mode is none', () => {
    renderFields({ mode: 'none' });

    // Shows the + Discount / Extra button
    const trigger = screen.getByRole('button', { name: '+ Discount / Extra' });
    expect(trigger).toBeInTheDocument();

    // Toggle options are not visible yet
    expect(screen.queryByRole('button', { name: 'Discount' })).not.toBeInTheDocument();
  });

  it('reveals the toggle options when + Discount / Extra is clicked', () => {
    renderFields({ mode: 'none' });

    const trigger = screen.getByRole('button', { name: '+ Discount / Extra' });
    fireEvent.click(trigger);

    // Now the toggle options are visible
    expect(screen.getByText('None')).toBeInTheDocument();
    expect(screen.getByText('Discount')).toBeInTheDocument();
    expect(screen.getByText('Extra')).toBeInTheDocument();
  });

  it('starts expanded when an adjustment already exists (mode !== none)', () => {
    renderFields({
      mode: 'discount',
      valueType: 'amount',
      value: '200',
      reason: 'Concession',
    });

    // Toggle options are immediately visible
    expect(screen.getByText('Discount')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Discount / Extra' })).not.toBeInTheDocument();

    // Reason field is present
    expect(screen.getByLabelText(/Reason \*/)).toBeInTheDocument();
  });

  it('collapses back when None is selected', () => {
    const onModeChange = vi.fn();
    renderFields({
      mode: 'none',
      onModeChange,
    });

    // Expand
    fireEvent.click(screen.getByRole('button', { name: '+ Discount / Extra' }));
    expect(screen.getByText('None')).toBeInTheDocument();

    // Click None
    fireEvent.click(screen.getByText('None'));
    expect(onModeChange).toHaveBeenCalledWith('none');

    // Collapsed back to + Discount / Extra
    expect(screen.getByRole('button', { name: '+ Discount / Extra' })).toBeInTheDocument();
  });

  it('shows one total box when nothing is adjusted, and the price box once it differs (New Visit)', () => {
    const { rerender, props } = renderFields({ mode: 'none', hideUnadjustedPrice: true });
    expect(screen.queryByText(/Subtotal/)).toBeNull();
    expect(screen.getByText(/Total: /)).toBeInTheDocument();
    rerender(<BillAdjustmentFields {...props} mode="discount" value="100" hideUnadjustedPrice />);
    expect(screen.getByText(/Subtotal/)).toBeInTheDocument();
  });

  it('keeps the price box by default (Edit visit)', () => {
    renderFields({ mode: 'none' });
    expect(screen.getByText(/Subtotal/)).toBeInTheDocument();
  });

  it('can be hidden again when opened by mistake with None selected', () => {
    renderFields({ mode: 'none' });
    fireEvent.click(screen.getByRole('button', { name: '+ Discount / Extra' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.getByRole('button', { name: '+ Discount / Extra' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
  });

  it('offers no Hide while an adjustment is set', () => {
    renderFields({ mode: 'discount', value: '100' });
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
  });

  it('keeps pristine form not dirty when disclosure is opened without setting an adjustment', () => {
    const formInput = {
      rows: [{ key: 'r1', assistingTherapistId: null }],
      patientId: null,
      creatingPatient: false,
      newPatientName: '',
      condition: '',
      notes: '',
      pendingNote: '',
      treatmentIds: [],
      adjustmentMode: 'none' as const,
    };

    const baselineSig = newVisitSignature(formInput);
    // Opening the disclosure does not change adjustmentMode (still 'none')
    const currentSig = newVisitSignature(formInput);

    expect(isNewVisitDirty({ justSaved: false, touched: true, signature: currentSig, baseline: baselineSig })).toBe(false);

    // Setting adjustment to discount changes the signature, making it dirty
    const dirtySig = newVisitSignature({ ...formInput, adjustmentMode: 'discount' });
    expect(isNewVisitDirty({ justSaved: false, touched: true, signature: dirtySig, baseline: baselineSig })).toBe(true);
  });
});
