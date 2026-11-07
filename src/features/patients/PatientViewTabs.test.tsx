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
