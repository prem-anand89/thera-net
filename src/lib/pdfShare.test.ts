import { describe, expect, it, vi } from 'vitest';
import {
  buildWhatsAppSendUrl,
  openPatientWhatsAppChat,
  openWhatsAppChat,
  shareTextViaWhatsApp,
} from './pdfShare';

describe('buildWhatsAppSendUrl', () => {
  it('prefixes 10-digit Indian numbers with 91', () => {
    const url = buildWhatsAppSendUrl('Hi', '9876543210');
    expect(url).toBe(`https://wa.me/919876543210?text=${encodeURIComponent('Hi')}`);
  });
});

describe('openPatientWhatsAppChat', () => {
  it('opens wa.me in a new tab like payment reminders', () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal('window', { open, location: { assign: vi.fn() } });
    openPatientWhatsAppChat('Hello', '9876543210');
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/919876543210'),
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('navigates the current tab when blocked after async feedback work', () => {
    const assign = vi.fn();
    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal('window', { open, location: { assign } });
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: () => ({ click: vi.fn(), remove: vi.fn() }),
    });
    openPatientWhatsAppChat('Hello', '9876543210', { navigateCurrentTabIfBlocked: true });
    expect(assign).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/919876543210'));
  });
});

describe('shareTextViaWhatsApp', () => {
  it('uses the same wa.me path as payment reminders', async () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal('window', { open });
    await shareTextViaWhatsApp('Hello', 'Title', null, '9876543210');
    expect(open).toHaveBeenCalled();
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
});
