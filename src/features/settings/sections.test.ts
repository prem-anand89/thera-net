import { describe, expect, it } from 'vitest';
import { SETTINGS_CARDS, matchSettingsCards, parseSettingsSearch } from './sections';

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

describe('matchSettingsCards', () => {
  it('finds the exact card that owns a setting', () => {
    expect(matchSettingsCards('gst').map((c) => c.id)).toEqual(['settings-card-billing-invoicing']);
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
