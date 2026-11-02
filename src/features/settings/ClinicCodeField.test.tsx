// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ClinicCodeField } from './ClinicCodeField';

const today = new Date('2026-11-02T10:00:00');
const input = () => screen.getByRole('textbox', { name: /Clinic code/ }) as HTMLInputElement;

function renderField(props: Partial<React.ComponentProps<typeof ClinicCodeField>> = {}) {
  const onChange = vi.fn();
  render(<ClinicCodeField invoicePrefix="BM" walkInMrnoPrefix="BM" fyStartMonth={4} invoicing onChange={onChange} today={today} {...props} />);
  return onChange;
}

describe('ClinicCodeField', () => {
  afterEach(cleanup);

  it('shows what the code does to Patient IDs and invoice numbers', () => {
    renderField();
    expect(screen.getByText(/Patient IDs look like BM26-0001 · Invoices look like BM\/26-27\/0001/)).toBeInTheDocument();
  });

  it('leaves the invoice example out on a plan without invoicing', () => {
    renderField({ invoicing: false });
    expect(screen.getByText(/Patient IDs look like BM26-0001/)).toBeInTheDocument();
    expect(screen.queryByText(/Invoices look like/)).toBeNull();
  });

  it('while the two codes are the same, editing changes both, uppercase and letters-or-digits only', () => {
    const onChange = renderField();
    fireEvent.change(input(), { target: { value: 'bmx/1' } });
    expect(onChange).toHaveBeenCalledWith({ invoicePrefix: 'BMX1', walkInMrnoPrefix: 'BMX1' });
  });

  it('a clinic whose codes differ keeps both until it taps "Use BM for both"', () => {
    const onChange = renderField({ walkInMrnoPrefix: 'A' });
    expect(screen.getByTestId('clinic-code-differs')).toHaveTextContent('Patient IDs use A.');
    fireEvent.change(input(), { target: { value: 'BMP' } });
    expect(onChange).toHaveBeenLastCalledWith({ invoicePrefix: 'BMP', walkInMrnoPrefix: 'A' });
    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Use BM for both' }));
    expect(onChange).toHaveBeenCalledWith({ invoicePrefix: 'BM', walkInMrnoPrefix: 'BM' });
  });

  it('a clinic with no patient prefix is on W and is offered the same button', () => {
    const onChange = renderField({ invoicePrefix: 'LAX', walkInMrnoPrefix: null });
    expect(screen.getByTestId('clinic-code-differs')).toHaveTextContent('Patient IDs use W.');
    expect(screen.getByText(/Patient IDs look like W26-0001/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use LAX for both' }));
    expect(onChange).toHaveBeenCalledWith({ invoicePrefix: 'LAX', walkInMrnoPrefix: 'LAX' });
  });

  it('shows nothing extra when the two codes already match', () => {
    renderField();
    expect(screen.queryByTestId('clinic-code-differs')).toBeNull();
  });

  it('follows the financial year start month in the invoice example', () => {
    renderField({ fyStartMonth: 1 });
    expect(screen.getByText(/Invoices look like BM\/26-27\/0001/)).toBeInTheDocument();
  });
});
