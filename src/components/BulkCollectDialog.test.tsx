// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const logPayment = vi.fn();
vi.mock('@/services', () => ({
  directPaymentService: { logPayment: (...a: unknown[]) => logPayment(...a) },
}));
vi.mock('@/lib/errors', () => ({ toFriendlyMessage: (e: Error) => e.message }));

import { BulkCollectDialog } from './BulkCollectDialog';

const rows = [
  { visitId: 'v1', duePaise: 150000 },
  { visitId: 'v2', duePaise: 0 },
  { visitId: 'v3', duePaise: 150000 },
];

describe('BulkCollectDialog', () => {
  beforeEach(() => logPayment.mockReset());
  afterEach(cleanup);

  it('records the full balance of each owing visit and skips settled ones', async () => {
    logPayment.mockResolvedValue({});
    const onClose = vi.fn();
    render(<BulkCollectDialog clinicId="c1" patientLabel="Ananya" rows={rows} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /^Collect/ }));
    expect(logPayment).toHaveBeenCalledTimes(2);
    expect(logPayment).toHaveBeenNthCalledWith(1, 'c1', 'v1', 150000, 'cash', expect.any(String), null);
    expect(logPayment).toHaveBeenNthCalledWith(2, 'c1', 'v3', 150000, 'cash', expect.any(String), null);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps going no further after a failure and says how many were recorded', async () => {
    logPayment.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('offline'));
    const onClose = vi.fn();
    render(<BulkCollectDialog clinicId="c1" patientLabel="Ananya" rows={rows} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /^Collect/ }));
    expect(await screen.findByText(/1 of 2 visits recorded/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
