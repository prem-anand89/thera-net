import { describe, expect, it } from 'vitest';
import { SETTINGS_CARDS, SETTINGS_TAB_META, matchSettingsCards, parseSettingsSearch } from './sections';

describe('parseSettingsSearch', () => {
  it('accepts the six current tabs', () => {
    for (const tab of ['general', 'team', 'services', 'booking', 'billing', 'account']) {
      expect(parseSettingsSearch({ tab })).toEqual({ tab });
    }
  });

  it('maps every old tab to its new home', () => {
    expect(parseSettingsSearch({ tab: 'profile' })).toEqual({ tab: 'general' });
    expect(parseSettingsSearch({ tab: 'patientComms' })).toEqual({ tab: 'booking' });
    expect(parseSettingsSearch({ tab: 'partner' })).toEqual({ tab: 'billing' });
    expect(parseSettingsSearch({ tab: 'catalog' })).toEqual({ tab: 'services' });
    expect(parseSettingsSearch({ tab: 'plan' })).toEqual({ tab: 'account' });
    expect(parseSettingsSearch({ tab: 'data' })).toEqual({ tab: 'account' });
  });

  it('keeps catalog views on the services tab, including pre-merge names', () => {
    expect(parseSettingsSearch({ tab: 'catalog', catalogView: 'referrals' })).toEqual({
      tab: 'services',
      catalogView: 'referrals',
    });
    expect(parseSettingsSearch({ tab: 'treatments' })).toEqual({ tab: 'services', catalogView: 'treatments' });
    expect(parseSettingsSearch({ tab: 'services' })).toEqual({ tab: 'services' });
  });

  it('drops unknown tabs and catalog views on other tabs', () => {
    expect(parseSettingsSearch({ tab: 'nope' })).toEqual({});
    expect(parseSettingsSearch({ tab: 'billing', catalogView: 'packages' })).toEqual({ tab: 'billing' });
    expect(parseSettingsSearch({})).toEqual({});
  });
});

describe('Schedule & Booking tab', () => {
  it('holds the clinic hours and closures card next to the booking page', () => {
    const owner = (id: string) => SETTINGS_CARDS.find((c) => c.id === id)?.tab;
    expect(owner('settings-card-booking-hours')).toBe('booking');
    expect(owner('settings-card-booking-online')).toBe('booking');
    // everything else in General stays put, and Payments stays reachable on every plan
    expect(owner('settings-card-payments')).toBe('general');
    expect(SETTINGS_TAB_META.booking.label).toBe('Schedule & Booking');
  });

  it('finds the hours card by what people type', () => {
    expect(matchSettingsCards('holiday').map((c) => c.id)).toContain('settings-card-booking-hours');
    expect(matchSettingsCards('appointment duration').map((c) => c.tab)).toEqual(['booking']);
  });
});

describe('matchSettingsCards', () => {
  it('finds the exact card that owns a setting', () => {
    expect(matchSettingsCards('gst').map((c) => c.id)).toEqual(['settings-card-billing-invoicing']);
    expect(matchSettingsCards('upi').map((c) => c.id)).toEqual(['settings-card-payments']);
    expect(matchSettingsCards('vpa').map((c) => c.id)).toEqual(['settings-card-payments']);
    expect(matchSettingsCards('whatsapp').map((c) => c.id)).toEqual(['settings-card-booking-online']);
    expect(matchSettingsCards('backup').map((c) => c.id)).toEqual(['settings-card-account-backup']);
  });

  it('returns nothing for an empty or unknown query', () => {
    expect(matchSettingsCards('')).toEqual([]);
    expect(matchSettingsCards('zzzz')).toEqual([]);
  });

  it('gives every card an id that exists on the page', () => {
    const ids = new Set<string>();
    for (const card of SETTINGS_CARDS) {
      expect(ids.has(card.id)).toBe(false);
      ids.add(card.id);
    }
  });
});
