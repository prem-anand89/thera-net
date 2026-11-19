import { describe, expect, it } from 'vitest';
import { sanitizeUrl } from './errorReporting';

describe('sanitizeUrl', () => {
  it('hides feedback, patient-page and booking tokens', () => {
    expect(sanitizeUrl('/f/abc123secret')).toBe('/f/[token]');
    expect(sanitizeUrl('/p/tok_9XyZ')).toBe('/p/[token]');
    expect(sanitizeUrl('/book/sunrise-physio')).toBe('/book/[clinic]');
  });
  it('replaces ids and drops the query and hash', () => {
    expect(sanitizeUrl('/patients/3f2b8c1e-1111-4222-8333-444455556666/visits?x=1#top')).toBe('/patients/[id]/visits');
    expect(sanitizeUrl('/ledger?token=secret')).toBe('/ledger');
  });
});
