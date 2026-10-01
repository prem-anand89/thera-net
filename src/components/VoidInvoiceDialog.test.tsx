// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Invoice } from '@/domain/types';

const voidInvoice = vi.fn();
vi.mock('@/services', () => ({ invoiceService: { voidInvoice: (...args: unknown[]) => voidInvoice(...args) } }));

import { VoidInvoiceDialog } from './VoidInvoiceDialog';

const invoice = { id: 'inv-1', invoiceNo: 'BM/26-27/0007', lineItems: [{}] } as unknown as Invoice;

describe('VoidInvoiceDialog', () => {
  afterEach(() => {
    cleanup();
    voidInvoice.mockReset();
  });

  it('needs a reason before it can void, then voids with that reason and closes', async () => {
    voidInvoice.mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<VoidInvoiceDialog invoice={invoice} receivedPaise={0} onClose={onClose} />);
    const confirm = screen.getByRole('button', { name: 'Void invoice' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Wrong amount/), { target: { value: 'Wrong amount entered' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(voidInvoice).toHaveBeenCalledWith('inv-1', 'Wrong amount entered');
  });

  it('says money already received stays recorded, and shows a failure instead of closing', async () => {
    voidInvoice.mockRejectedValue(new Error('Could not void invoice: this invoice was amended'));
    const onClose = vi.fn();
    render(<VoidInvoiceDialog invoice={invoice} receivedPaise={30000} onClose={onClose} />);
    expect(screen.getByText(/₹300 already received stays recorded/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Wrong amount/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Void invoice' }));
    await waitFor(() => expect(screen.getByText(/amended/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
