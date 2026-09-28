import { describe, expect, it, vi } from 'vitest';
import { shareTextViaWhatsApp } from './pdfShare';

describe('shareTextViaWhatsApp', () => {
  it('navigates a pre-opened popup instead of calling navigator.share after async work', async () => {
    const share = vi.fn();
    vi.stubGlobal('navigator', { share });
    const popup = {
      closed: false,
      location: { href: '' },
      close: vi.fn(),
    } as unknown as Window;

    await shareTextViaWhatsApp('Hello', 'Title', popup, '9876543210');

    expect(share).not.toHaveBeenCalled();
    expect(popup.location.href).toContain('https://wa.me/919876543210');
    expect(popup.location.href).toContain(encodeURIComponent('Hello'));
  });
});
