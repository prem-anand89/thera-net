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

    // Now the toggle options and remove button are visible
    expect(screen.getByRole('button', { name: 'Discount' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extra' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove adjustment/i })).toBeInTheDocument();
  });

  it('starts expanded when an adjustment already exists (mode !== none)', () => {
    renderFields({
      mode: 'discount',
      valueType: 'amount',
      value: '200',
      reason: 'Concession',
    });

    // Toggle options are immediately visible
    expect(screen.getByRole('button', { name: 'Discount' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Discount / Extra' })).not.toBeInTheDocument();

    // Reason input is present
    expect(screen.getByPlaceholderText(/loyalty discount/i)).toBeInTheDocument();
  });

  it('collapses back when remove button is clicked', () => {
    const onModeChange = vi.fn();
    renderFields({
      mode: 'none',
      onModeChange,
    });

    // Expand
    fireEvent.click(screen.getByRole('button', { name: '+ Discount / Extra' }));
    expect(screen.getByRole('button', { name: 'Discount' })).toBeInTheDocument();

    // Click remove (✕)
    fireEvent.click(screen.getByRole('button', { name: /Remove adjustment/i }));
    expect(onModeChange).toHaveBeenCalledWith('none');

    // Collapsed back to + Discount / Extra
    expect(screen.getByRole('button', { name: '+ Discount / Extra' })).toBeInTheDocument();
  });

  it('clicking a % preset chip updates value when percent is active', () => {
    const onValueChange = vi.fn();
    renderFields({
      mode: 'discount',
      valueType: 'percent',
      value: '',
      onValueChange,
    });

    fireEvent.click(screen.getByRole('button', { name: '10%' }));
    expect(onValueChange).toHaveBeenCalledWith('10');
  });

  it('switches to rupee amount presets when amount is active', () => {
    const onValueChange = vi.fn();
    renderFields({
      mode: 'discount',
      valueType: 'amount',
      value: '',
      onValueChange,
    });

    fireEvent.click(screen.getByRole('button', { name: '₹100' }));
    expect(onValueChange).toHaveBeenCalledWith('100');
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

  it('clicking a reason preset chip updates reason in 1 tap', () => {
    const onReasonChange = vi.fn();
    renderFields({
      mode: 'discount',
      valueType: 'percent',
      value: '10',
      reason: '',
      onReasonChange,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Loyalty' }));
    expect(onReasonChange).toHaveBeenCalledWith('Loyalty');
  });

  it('reveals custom reason input when + Other... is clicked', () => {
    renderFields({
      mode: 'discount',
      valueType: 'percent',
      value: '10',
      reason: '',
    });

    fireEvent.click(screen.getByRole('button', { name: '+ Other...' }));
    expect(screen.getByPlaceholderText(/senior citizen concession/i)).toBeInTheDocument();
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

  it('renders smart round-off chip when subtotal is an odd rupee amount', () => {
    const onValueChange = vi.fn();
    renderFields({
      catalogPricePaise: 540000, // ₹5,400
      mode: 'discount',
      valueType: 'amount',
      value: '',
      onValueChange,
    });

    const roundOffButton = screen.getByRole('button', { name: 'Round to ₹5,000' });
    expect(roundOffButton).toBeInTheDocument();

    fireEvent.click(roundOffButton);
    expect(onValueChange).toHaveBeenCalledWith('400');
  });

  it('adapts presets and reasons when switching to Extra mode', () => {
    const onModeChange = vi.fn();
    const onReasonChange = vi.fn();
    const onValueTypeChange = vi.fn();
    const onValueChange = vi.fn();

    renderFields({
      mode: 'discount',
      valueType: 'percent',
      value: '10',
      reason: 'Loyalty',
      onModeChange,
      onReasonChange,
      onValueTypeChange,
      onValueChange,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Extra' }));
    expect(onModeChange).toHaveBeenCalledWith('extra');
    expect(onValueTypeChange).toHaveBeenCalledWith('amount');
    expect(onValueChange).toHaveBeenCalledWith('200');
    expect(onReasonChange).toHaveBeenCalledWith('Consumables / Tape');
  });

  it('shows live computed delta badge next to % presets', () => {
    renderFields({
      catalogPricePaise: 540000, // ₹5,400
      mode: 'discount',
      valueType: 'percent',
      value: '10', // 10% = ₹540
      reason: 'Loyalty',
    });

    expect(screen.getByText('−₹540')).toBeInTheDocument();
  });
});
