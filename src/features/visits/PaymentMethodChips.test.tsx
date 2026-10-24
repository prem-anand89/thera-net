// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentMethodChips, type PaymentMethodOption } from './PaymentMethodChips';

afterEach(cleanup);

describe('PaymentMethodChips', () => {
  const fullOptions: PaymentMethodOption[] = [
    { value: 'upi', label: 'UPI' },
    { value: 'cash', label: 'Cash' },
    { value: 'card', label: 'Card' },
    { value: 'bank_transfer', label: 'Bank transfer' },
    { value: 'cheque', label: 'Cheque' },
  ];

  it('preselects default method as checked radio', () => {
    const onChange = vi.fn();
    render(
      <PaymentMethodChips
        value="upi"
        onChange={onChange}
        options={fullOptions}
      />
    );

    const upiRadio = screen.getByRole('radio', { name: 'UPI' });
    expect(upiRadio).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Cash' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Card' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /Other/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('omits Card chip if clinic lacks Card option', () => {
    const noCardOptions: PaymentMethodOption[] = [
      { value: 'upi', label: 'UPI' },
      { value: 'cash', label: 'Cash' },
      { value: 'bank_transfer', label: 'Bank transfer' },
    ];
    const onChange = vi.fn();
    render(
      <PaymentMethodChips
        value="upi"
        onChange={onChange}
        options={noCardOptions}
      />
    );

    expect(screen.getByRole('radio', { name: 'UPI' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Cash' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Card' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Other/ })).toBeInTheDocument();
  });

  it('displays the selected method name and highlights when an Other method is selected', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PaymentMethodChips
        value="bank_transfer"
        onChange={onChange}
        options={fullOptions}
      />
    );

    const otherRadio = screen.getByRole('radio', { name: /Bank transfer/ });
    expect(otherRadio).toBeInTheDocument();
    expect(otherRadio).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'UPI' })).toHaveAttribute('aria-checked', 'false');

    // Switch to cheque
    rerender(
      <PaymentMethodChips
        value="cheque"
        onChange={onChange}
        options={fullOptions}
      />
    );
    expect(screen.getByRole('radio', { name: /Cheque/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('includes Collected by partner option when present in options', () => {
    const partnerOptions: PaymentMethodOption[] = [
      { value: 'upi', label: 'UPI' },
      { value: 'cash', label: 'Cash' },
      { value: 'partner', label: 'Collected by Apollo' },
    ];
    const onChange = vi.fn();
    render(
      <PaymentMethodChips
        value="partner"
        onChange={onChange}
        options={partnerOptions}
      />
    );

    const partnerRadio = screen.getByRole('radio', { name: /Collected by Apollo/ });
    expect(partnerRadio).toBeInTheDocument();
    expect(partnerRadio).toHaveAttribute('aria-checked', 'true');

    // Clicking it opens the menu
    fireEvent.click(partnerRadio);
    expect(screen.getByRole('menuitem', { name: /Collected by Apollo/ })).toBeInTheDocument();
  });

  it('supports selecting a primary chip on click', () => {
    const onChange = vi.fn();
    render(
      <PaymentMethodChips
        value="upi"
        onChange={onChange}
        options={fullOptions}
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Cash' }));
    expect(onChange).toHaveBeenCalledWith('cash');
  });

  it('supports selecting an item from the Other menu', () => {
    const onChange = vi.fn();
    render(
      <PaymentMethodChips
        value="upi"
        onChange={onChange}
        options={fullOptions}
      />
    );

    // Click Other ▾ to open menu
    const otherRadio = screen.getByRole('radio', { name: /Other/ });
    fireEvent.click(otherRadio);

    // Menu should be open with other options
    const bankTransferItem = screen.getByRole('menuitem', { name: 'Bank transfer' });
    fireEvent.click(bankTransferItem);

    expect(onChange).toHaveBeenCalledWith('bank_transfer');
  });

  it('supports keyboard navigation across chips with arrow keys', () => {
    const onChange = vi.fn();
    render(
      <PaymentMethodChips
        value="upi"
        onChange={onChange}
        options={fullOptions}
      />
    );

    const upiRadio = screen.getByRole('radio', { name: 'UPI' });

    // ArrowRight moves from UPI to Cash
    fireEvent.keyDown(upiRadio, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('cash');

    // ArrowLeft moves from UPI to Other
    fireEvent.keyDown(upiRadio, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('bank_transfer');
  });
});
