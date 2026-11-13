// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildHepPatientMessage,
  buildHepPatientMessageUrl,
  buildHepPortalUrl,
  buildHepShareMessage,
  buildHepWhatsAppShareUrl,
  HEP_CAREGIVER_LINE,
  HEP_MESSAGE_KINDS,
  HEP_PIN_PROMPT,
  type HepMessageKind,
} from './hepSharing';

const base = { token: 'tok-xyz-987', clinicName: 'Sunrise Physiotherapy', origin: 'https://thera-net-three.vercel.app' };
const decode = (url: string) => decodeURIComponent(url.split('?text=')[1]);

describe('HEP WhatsApp messages', () => {
  it('builds the portal link on the app\'s own address, tidy about a trailing slash and an odd token', () => {
    expect(buildHepPortalUrl('tok-1', 'https://app.example/')).toBe('https://app.example/p/tok-1');
    expect(buildHepPortalUrl('a b/c', 'https://app.example')).toBe('https://app.example/p/a%20b%2Fc');
    expect(buildHepPortalUrl('t')).toBe(`${window.location.origin}/p/t`);
  });

  it('starts with the clinic name, then the link, a PIN prompt with no digits of a PIN, and the caregiver line', () => {
    const text = buildHepShareMessage(base);
    expect(text.split('\n')[0]).toBe('Sunrise Physiotherapy: here is your home exercise program.');
    expect(text).toContain('https://thera-net-three.vercel.app/p/tok-xyz-987');
    expect(text).toContain(HEP_PIN_PROMPT);
    expect(text).toContain(HEP_CAREGIVER_LINE);
    expect(HEP_CAREGIVER_LINE).toBe('Share this link only with the patient or the person helping them.');
    // no PIN, no "last digits" hint, no consent wording
    expect(text.replace('4-digit', '')).not.toMatch(/\d{4}/);
    expect(text).not.toMatch(/last 4 digits|mobile number|agree to receive/i);
  });

  it('opens the patient\'s own WhatsApp chat using the clinic\'s country code, or a contact picker without a number', () => {
    const withPhone = buildHepWhatsAppShareUrl({ ...base, phone: '+91 98765 43210' });
    expect(withPhone.startsWith('https://wa.me/919876543210?text=')).toBe(true);
    expect(decode(withPhone)).toBe(buildHepShareMessage(base));
    expect(buildHepWhatsAppShareUrl({ ...base, phone: '' }).startsWith('https://wa.me/?text=')).toBe(true);
    expect(buildHepWhatsAppShareUrl({ ...base }).startsWith('https://wa.me/?text=')).toBe(true);
  });

  it.each(Object.keys(HEP_MESSAGE_KINDS) as HepMessageKind[])('the "%s" message has the clinic name and the link and nothing about the patient or a PIN', (kind) => {
    const text = buildHepPatientMessage(kind, base);
    expect(text).toBe(`Sunrise Physiotherapy: ${HEP_MESSAGE_KINDS[kind]}\n\nhttps://thera-net-three.vercel.app/p/tok-xyz-987`);
    expect(text).not.toMatch(/PIN|\d{4}/);
  });

  it('has the five presets the therapist can pick from', () => {
    expect(Object.values(HEP_MESSAGE_KINDS)).toEqual([
      'Reminder to do your exercises',
      'How are you feeling with your exercises?',
      'Time for a check-in with us',
      'Your program has ended. How did it go?',
      'Here is your exercise program again.',
    ]);
  });

  it('sends a preset to the patient\'s number', () => {
    const url = buildHepPatientMessageUrl('reminder', { ...base, phone: '98765 43210' });
    expect(url.startsWith('https://wa.me/')).toBe(true);
    expect(decode(url)).toContain('Reminder to do your exercises');
  });
});
