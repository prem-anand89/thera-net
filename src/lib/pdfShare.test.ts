import { describe, expect, it, vi } from 'vitest';
import { buildWhatsAppSendUrl, openWhatsAppChat, shareTextViaWhatsApp } from './pdfShare';

describe('buildWhatsAppSendUrl', () => {
  it('prefixes 10-digit Indian numbers with 91', () => {
    const url = buildWhatsAppSendUrl('Hi', '9876543210');
    expect(url).toBe(`https://wa.me/919876543210?text=${encodeURIComponent('Hi')}`);
  });
});

describe('shareTextViaWhatsApp', () => {
  it('navigates a pre-opened popup to wa.me with the patient number', async () => {
    const popup = {
      closed: false,
      location: { href: '' },
      close: vi.fn(),
    } as unknown as Window;

    await shareTextViaWhatsApp('Hello', 'Title', popup, '9876543210');

    expect(popup.location.href).toContain('https://wa.me/919876543210');
    expect(popup.location.href).toContain(encodeURIComponent('Hello'));
  });
});

describe('openWhatsAppChat', () => {
  it('opens a new tab when no popup is passed', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    openWhatsAppChat('Pay now', '8127312730');
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/918127312730'),
      '_blank',
      'noopener,noreferrer'
    );
  });
});
