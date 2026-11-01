import { describe, expect, it } from 'vitest';
import { buildUpgradeMailto } from './support';

describe('buildUpgradeMailto', () => {
  const body = (url: string) => decodeURIComponent(url.split('&body=')[1]);

  it('names the clinic, its id, the current plan and what they are using', () => {
    const url = buildUpgradeMailto('help@example.com', 'BM Physio', 'Lite', { clinicId: 'c-123', usage: '47 of 50 visits this month' });
    expect(url.startsWith('mailto:help@example.com?subject=')).toBe(true);
    expect(decodeURIComponent(url.split('?subject=')[1].split('&body=')[0])).toBe('Upgrade request: BM Physio');
    expect(body(url)).toContain('Clinic ID: c-123');
    expect(body(url)).toContain('Current plan: Lite');
    expect(body(url)).toContain('Usage: 47 of 50 visits this month');
  });

  it('still works with no details', () => {
    expect(body(buildUpgradeMailto('help@example.com', 'BM', 'Solo'))).toBe(
      'Hello, we are on the Solo plan and would like to upgrade BM.\n\nClinic: BM\nCurrent plan: Solo'
    );
  });
});
