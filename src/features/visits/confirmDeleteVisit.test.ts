import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/notify', () => ({ askConfirm: vi.fn(), notify: { error: vi.fn() } }));
vi.mock('@/services', () => ({ repos: {} }));
vi.mock('@/lib/errors', () => ({ toFriendlyMessage: (e: unknown) => String(e) }));

import { deleteVisitMessage } from './confirmDeleteVisit';

describe('deleteVisitMessage', () => {
  it('a visit with nothing collected keeps the short text', () => {
    expect(deleteVisitMessage(0)).toBe('It is removed from the records.');
  });

  it('a visit with money collected says the amount leaves the Daybook and to record it again', () => {
    const msg = deleteVisitMessage(150000);
    expect(msg).toMatch(/1,500/);
    expect(msg).toMatch(/Daybook/);
    expect(msg).toMatch(/record the payment again/);
  });
});
