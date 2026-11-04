import { noticeStore } from '@/lib/notify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setClinicRuntime } from '@/domain/clinicRuntime';
import {
  buildWhatsAppSendUrl,
  normalizePhoneForWaMe,
  openPatientWhatsAppChat,
  openWhatsAppChat,
  shareFileToWhatsApp,
  shareTextViaWhatsApp,
} from './pdfShare';

describe('normalizePhoneForWaMe', () => {
  it('prefixes 10-digit Indian numbers with 91', () => {
    expect(normalizePhoneForWaMe('9876543210')).toBe('919876543210');
  });

  it('strips leading 0 from 11-digit numbers and prefixes 91', () => {
    expect(normalizePhoneForWaMe('09876543210')).toBe('919876543210');
  });

  it('handles +91 formatted numbers', () => {
    expect(normalizePhoneForWaMe('+91 98765 43210')).toBe('919876543210');
  });

  it('strips leading 00 international call prefix', () => {
    expect(normalizePhoneForWaMe('00919876543210')).toBe('919876543210');
  });

  it('a bare 10-digit Indian mobile starting with 91 still gets its 91', () => {
    expect(normalizePhoneForWaMe('9198765432')).toBe('919198765432');
  });

  it('a stored number keeps its own code whatever its length (it used to get 91 added)', () => {
    expect(normalizePhoneForWaMe('+65 91234567')).toBe('6591234567');
    expect(normalizePhoneForWaMe('+971 501234567')).toBe('971501234567');
    expect(normalizePhoneForWaMe('+1 212 555 1234')).toBe('12125551234');
    expect(normalizePhoneForWaMe('006591234567')).toBe('6591234567');
  });

  describe('a clinic outside India', () => {
    afterEach(() => setClinicRuntime({}));

    it('bare numbers take its code, and a trunk 0 is dropped', () => {
      setClinicRuntime({ countryCode: '+971' });
      expect(normalizePhoneForWaMe('501234567')).toBe('971501234567');
      expect(normalizePhoneForWaMe('0501234567')).toBe('971501234567');
      setClinicRuntime({ countryCode: '+44' });
      expect(normalizePhoneForWaMe('07123456789')).toBe('447123456789');
    });

    it('an Indian number stored with its code stays Indian', () => {
      setClinicRuntime({ countryCode: '+44' });
      expect(normalizePhoneForWaMe('+91 98765 43210')).toBe('919876543210');
    });
  });

  it('nothing to dial gives nothing', () => {
    expect(normalizePhoneForWaMe('')).toBe('');
    expect(normalizePhoneForWaMe(' - ')).toBe('');
  });
});

describe('buildWhatsAppSendUrl', () => {
  it('prefixes 10-digit Indian numbers with 91', () => {
    const url = buildWhatsAppSendUrl('Hi', '9876543210');
    expect(url).toBe(`https://wa.me/919876543210?text=${encodeURIComponent('Hi')}`);
  });

  it('builds generic wa.me URL when phone is omitted', () => {
    const url = buildWhatsAppSendUrl('Hi');
    expect(url).toBe(`https://wa.me/?text=${encodeURIComponent('Hi')}`);
  });
});

describe('openPatientWhatsAppChat', () => {
  it('opens wa.me in a new tab like payment reminders', () => {
    const fakeWindow = { opener: {} as unknown, closed: false };
    const open = vi.fn().mockReturnValue(fakeWindow);
    vi.stubGlobal('window', { open, location: { assign: vi.fn() } });
    openPatientWhatsAppChat('Hello', '9876543210');
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/919876543210'),
      '_blank'
    );
    expect(fakeWindow.opener).toBeNull();
  });

  it('shows a notice when blocked after async feedback work', () => {
    noticeStore.reset();
    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal('window', { open });
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: () => ({ click: vi.fn(), remove: vi.fn() }),
    });
    openPatientWhatsAppChat('Hello', '9876543210');
    expect(noticeStore.notices().map((n) => n.message).join(' ')).toContain('blocking pop-ups');
  });

  it('notifies error when patient phone is missing or contains no digits', () => {
    noticeStore.reset();
    openPatientWhatsAppChat('Hello', '   ');
    expect(noticeStore.notices().map((n) => n.message).join(' ')).toContain('no phone number on file');
  });
});

describe('shareFileToWhatsApp', () => {
  const dummyFile = new File(['content'], 'invoice.pdf', { type: 'application/pdf' });

  it('falls back to wa.me URL with direct patient phone when Web Share is unsupported', async () => {
    const fakeWindow = { opener: {} as unknown, closed: false };
    const open = vi.fn().mockReturnValue(fakeWindow);
    vi.stubGlobal('window', { open });
    vi.stubGlobal('navigator', {});

    const result = await shareFileToWhatsApp(dummyFile, 'Invoice 101', 'Invoice summary', '9876543210');
    expect(result).toBe('fallback');
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/919876543210?text='),
      '_blank'
    );
  });

  it('falls back to wa.me URL when nav.share throws NotAllowedError (expired user gesture)', async () => {
    const fakeWindow = { opener: {} as unknown, closed: false };
    const open = vi.fn().mockReturnValue(fakeWindow);
    vi.stubGlobal('window', { open });
    const share = vi.fn().mockRejectedValue(new DOMException('User gesture expired', 'NotAllowedError'));
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { share, canShare });

    const result = await shareFileToWhatsApp(dummyFile, 'Invoice 101', 'Invoice summary', '9876543210');
    expect(result).toBe('fallback');
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/919876543210?text='),
      '_blank'
    );
  });

  it('returns shared when user cancels share sheet without falling back to url', async () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    const share = vi.fn().mockRejectedValue(new DOMException('User aborted', 'AbortError'));
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { share, canShare });

    const result = await shareFileToWhatsApp(dummyFile, 'Invoice 101', 'Invoice summary', '9876543210');
    expect(result).toBe('shared');
    expect(open).not.toHaveBeenCalled();
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
    const fakeWindow = { opener: {} as unknown, closed: false };
    const open = vi.fn().mockReturnValue(fakeWindow);
    vi.stubGlobal('window', { open });
    expect(openWhatsAppChat('Pay now', '8127312730')).toBe(true);
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/918127312730'),
      '_blank'
    );
    expect(fakeWindow.opener).toBeNull();
  });
});
