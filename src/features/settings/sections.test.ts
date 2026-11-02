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

  it('keeps the two catalog views on the services tab, including the pre-merge treatments name', () => {
    expect(parseSettingsSearch({ tab: 'catalog', catalogView: 'treatments' })).toEqual({
      tab: 'services',
      catalogView: 'treatments',
    });
    expect(parseSettingsSearch({ tab: 'treatments' })).toEqual({ tab: 'services', catalogView: 'treatments' });
    expect(parseSettingsSearch({ tab: 'services' })).toEqual({ tab: 'services' });
  });

  it('sends every old referral-sources link to the General tab, at the card', () => {
    const landing = { tab: 'general', card: 'referrals' };
    expect(parseSettingsSearch({ tab: 'catalog', catalogView: 'referrals' })).toEqual(landing);
    expect(parseSettingsSearch({ tab: 'services', catalogView: 'referrals' })).toEqual(landing);
    expect(parseSettingsSearch({ tab: 'referrals' })).toEqual(landing);
    expect(parseSettingsSearch({ catalogView: 'referrals' })).toEqual(landing);
    expect(parseSettingsSearch({ tab: 'services', catalogView: 'referrals', fromSetup: true })).toEqual({ ...landing, fromSetup: true });
  });

  it('opens the Team tab on the view asked for, falling back to members', () => {
    expect(parseSettingsSearch({ tab: 'team', teamView: 'shifts' })).toEqual({ tab: 'team', teamView: 'shifts' });
    expect(parseSettingsSearch({ tab: 'team', teamView: 'members' })).toEqual({ tab: 'team', teamView: 'members' });
    expect(parseSettingsSearch({ tab: 'team', teamView: 'nope' })).toEqual({ tab: 'team' });
    expect(parseSettingsSearch({ tab: 'billing', teamView: 'shifts' })).toEqual({ tab: 'billing' });
  });

  it('search opens the shifts view for shift cards', () => {
    expect(matchSettingsCards('shift')[0]).toMatchObject({ tab: 'team', teamView: 'shifts' });
    expect(matchSettingsCards('invite')[0]).toMatchObject({ tab: 'team', teamView: 'members' });
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
    // Payments moved to the Billing tab, which is never hidden, so every plan still reaches it
    expect(owner('settings-card-payments')).toBe('billing');
    expect(SETTINGS_TAB_META.booking.label).toBe('Schedule & Booking');
    expect(SETTINGS_TAB_META.billing.label).toBe('Payments & billing');
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
    expect(matchSettingsCards('upi').map((c) => c.tab)).toEqual(['billing']);
    expect(matchSettingsCards('vpa').map((c) => c.id)).toEqual(['settings-card-payments']);
    expect(matchSettingsCards('clinical notes').map((c) => c.id)).toEqual(['settings-card-after-visit']);
    expect(matchSettingsCards('feedback').map((c) => c.id)).toEqual(['settings-card-after-visit']);
    expect(matchSettingsCards('google review').map((c) => c.id)).toEqual(['settings-card-after-visit']);
    expect(matchSettingsCards('booking link').map((c) => c.id)).toEqual(['settings-card-booking-online']);
    expect(matchSettingsCards('whatsapp').map((c) => c.id)).toEqual(['settings-card-booking-online']);
    expect(matchSettingsCards('backup').map((c) => c.id)).toEqual(['settings-card-account-backup']);
  });

  it('finds every setting people search for, in the card that holds it now', () => {
    const first = (q: string) => matchSettingsCards(q)[0]?.id;
    expect(first('timezone')).toBe('settings-card-region');
    expect(first('time zone')).toBe('settings-card-region');
    expect(first('agenda')).toBe('settings-card-region');
    expect(first('financial year')).toBe('settings-card-region');
    expect(first('shift')).toBe('settings-card-team-shifts');
    expect(matchSettingsCards('signature').map((c) => c.id)).toEqual(['settings-card-general-profile']);
    expect(matchSettingsCards('clinic code').map((c) => c.id)).toEqual(['settings-card-general-profile']);
    expect(matchSettingsCards('partner').map((c) => c.id)).toEqual(['settings-card-billing-partner']);
    expect(matchSettingsCards('lunch').map((c) => c.id)).toEqual(['settings-card-booking-hours']);
    expect(matchSettingsCards('opening hours').map((c) => c.id)).toEqual(['settings-card-booking-hours']);
    expect(matchSettingsCards('open days').map((c) => c.id)).toEqual(['settings-card-booking-hours']);
    expect(matchSettingsCards('staff can book outside').map((c) => c.id)).toEqual(['settings-card-booking-hours']);
  });

  it('no longer offers words for settings that are gone', () => {
    expect(matchSettingsCards('weekly closed')).toEqual([]);
    expect(matchSettingsCards('buffer')).toEqual([]);
    expect(matchSettingsCards('slot')).toEqual([]);
  });

  it('lists cards in the order they appear on the page', () => {
    const tabsInOrder = SETTINGS_CARDS.map((c) => c.tab).filter((t, i, all) => all.indexOf(t) === i);
    expect(tabsInOrder).toEqual(['general', 'team', 'services', 'booking', 'billing', 'account']);
    const booking = SETTINGS_CARDS.filter((c) => c.tab === 'booking').map((c) => c.id);
    expect(booking).toEqual(['settings-card-booking-hours', 'settings-card-booking-online']);
  });

  it('names the tab "Services & treatments" and the referral card "How patients found you" on General', () => {
    expect(SETTINGS_TAB_META.services.label).toBe('Services & treatments');
    const card = SETTINGS_CARDS.find((c) => c.id === 'settings-card-general-referrals');
    expect(card).toMatchObject({ title: 'How patients found you', tab: 'general' });
    expect(matchSettingsCards('referral').map((c) => c.id)).toEqual(['settings-card-general-referrals']);
    expect(matchSettingsCards('referred by').map((c) => c.tab)).toEqual(['general']);
  });

  it('finds the services and treatments cards by the words people use', () => {
    expect(matchSettingsCards('prices').map((c) => c.id)).toContain('settings-card-services-packages');
    expect(matchSettingsCards('price list').map((c) => c.id)).toEqual(['settings-card-services-packages']);
    expect(matchSettingsCards('treatments').map((c) => c.id)).toContain('settings-card-services-treatments');
    expect(matchSettingsCards('quick picks').map((c) => c.id)).toEqual(['settings-card-services-treatments']);
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
