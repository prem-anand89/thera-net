import { describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({ hasSupabaseConfig: true }));

const { toFriendlyMessage } = await import('./errors');

function postgrestError(message: string, code: string) {
  return { message, code, details: null, hint: null } as never;
}

describe('toFriendlyMessage', () => {
  it('translates known P0001 raise-exception text', () => {
    expect(toFriendlyMessage(postgrestError('issued invoices are immutable; corrections require an amendment record', 'P0001'))).toBe(
      'This invoice has already been issued and can no longer be edited. Create an amendment instead.'
    );
  });

  it('distinguishes the two "visit is on issued invoice" variants with an interpolated id', () => {
    const invoiceId = '3f2b6c1a-000-000-000-abcdef123456';
    expect(
      toFriendlyMessage(postgrestError(`visit is on issued invoice ${invoiceId}; it cannot be deleted`, 'P0001'))
    ).toBe('This visit is on an issued invoice and cannot be deleted. Create an amendment instead.');
    expect(
      toFriendlyMessage(postgrestError(`visit is on issued invoice ${invoiceId}; financial fields are frozen`, 'P0001'))
    ).toBe('This visit is on an issued invoice, so its billing details are locked. Create an amendment instead.');
  });

  it('prefers a specific unique-constraint pattern over the generic code message', () => {
    expect(
      toFriendlyMessage(
        postgrestError('duplicate key value violates unique constraint "patients_clinic_id_mrno_key"', '23505')
      )
    ).toBe('A patient with this MR number already exists in this clinic.');
  });

  it('falls back to the generic code message for an unrecognized 23505', () => {
    expect(toFriendlyMessage(postgrestError('duplicate key value violates unique constraint "some_other_key"', '23505'))).toBe(
      'That record already exists — check for a duplicate.'
    );
  });

  it('treats a network TypeError as offline', () => {
    expect(toFriendlyMessage(new TypeError('Failed to fetch'))).toBe(
      "You're offline (or not connected to the server). Check your connection and try again."
    );
  });

  it('falls back for an unrecognized value', () => {
    expect(toFriendlyMessage({ weird: 'object' })).toBe(
      'Something went wrong. Try again, and if it keeps happening, tell your admin.'
    );
    expect(toFriendlyMessage(42)).toBe('Something went wrong. Try again, and if it keeps happening, tell your admin.');
  });

  it('passes through an already-friendly hand-written Error unchanged', () => {
    expect(toFriendlyMessage(new Error('Select a therapist'))).toBe('Select a therapist');
    expect(toFriendlyMessage(new Error('Supabase is not configured'))).toBe('Supabase is not configured');
  });

  it('re-maps a double-leak wrapper Error that embeds a raw Postgrest message', () => {
    expect(
      toFriendlyMessage(new Error('Could not issue invoice: patient has 3 visit(s); hide the patient instead of deleting'))
    ).toBe('This patient has recorded visits and cannot be permanently deleted. Use "Hide" instead.');
  });
});

describe('toFriendlyMessage when Supabase is not configured', () => {
  it('always reports offline', async () => {
    vi.resetModules();
    vi.doMock('./env', () => ({ hasSupabaseConfig: false }));
    const { toFriendlyMessage: toFriendlyMessageUnconfigured } = await import('./errors');
    expect(toFriendlyMessageUnconfigured(new Error('anything'))).toBe(
      "You're offline (or not connected to the server). Check your connection and try again."
    );
  });
});
