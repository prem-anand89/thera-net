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
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal('window', { open });
    expect(openWhatsAppChat('Pay now', '8127312730')).toBe(true);
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/918127312730'),
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('returns false when pop-up is blocked', () => {
    const open = vi.fn().mockReturnValue(null);
    const alert = vi.fn();
    vi.stubGlobal('window', { open });
    vi.stubGlobal('alert', alert);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    expect(openWhatsAppChat('Pay now', '9876543210')).toBe(false);
    expect(alert).toHaveBeenCalled();
  });
});
