import { describe, expect, it } from 'vitest';
import { canMarkOutstanding, invoiceRowStatus } from './invoiceStatus';

describe('invoiceRowStatus', () => {
  it('reads a missing status row as paid, like the rest of the app', () => {
    expect(invoiceRowStatus(undefined)).toBe('paid');
    expect(invoiceRowStatus('outstanding')).toBe('outstanding');
    expect(invoiceRowStatus('void')).toBe('void');
  });
});

describe('canMarkOutstanding', () => {
  it('offers the undo only for a paid flag with no money recorded against it', () => {
    expect(canMarkOutstanding('paid', 0)).toBe(true);
    expect(canMarkOutstanding('paid', 50000)).toBe(false);
    expect(canMarkOutstanding('outstanding', 0)).toBe(false);
    expect(canMarkOutstanding('void', 0)).toBe(false);
  });
});
