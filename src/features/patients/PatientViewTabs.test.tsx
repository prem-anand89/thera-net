// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PatientViewTabs } from './PatientViewTabs';

afterEach(cleanup);

describe('PatientViewTabs', () => {
  it('names both tabs with their counts and marks the active one', () => {
    render(<PatientViewTabs active="visits" visitCount={12} invoiceCount={3} onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Visits (12)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Invoices (3)' })).toHaveAttribute('aria-selected', 'false');
  });

  it('switches on click and on the arrow keys', () => {
    const onChange = vi.fn();
    render(<PatientViewTabs active="visits" visitCount={1} invoiceCount={1} onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Invoices (1)' }));
    expect(onChange).toHaveBeenLastCalledWith('invoices');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Visits (1)' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('invoices');
  });
});

describe('PatientViewTabs: Home program', () => {
  it('shows the Home program tab only when asked (clinical staff), even with Invoices hidden', () => {
    const { rerender } = render(<PatientViewTabs active="visits" visitCount={2} invoiceCount={0} showInvoices={false} onChange={() => {}} />);
    expect(screen.queryByRole('tab', { name: /Home program/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Invoices/ })).toBeNull();
    rerender(<PatientViewTabs active="visits" visitCount={2} invoiceCount={0} showInvoices={false} showHomeProgram onChange={() => {}} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Visits (2)', 'Home program']);
  });

  it('shows a red dot with a spoken note while a pain report is waiting, and not otherwise', () => {
    const { rerender } = render(<PatientViewTabs active="visits" visitCount={1} invoiceCount={1} showHomeProgram homeProgramDot onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Home program, a pain report is waiting' })).toBeInTheDocument();
    rerender(<PatientViewTabs active="visits" visitCount={1} invoiceCount={1} showHomeProgram onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Home program' })).toBeInTheDocument();
  });

  it('arrow keys move through every tab that is showing, and wrap round', () => {
    const onChange = vi.fn();
    render(<PatientViewTabs active="visits" visitCount={1} invoiceCount={1} showHomeProgram onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Invoices (1)' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('home-program');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Home program' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('visits');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Visits (1)' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('home-program');
  });
});
