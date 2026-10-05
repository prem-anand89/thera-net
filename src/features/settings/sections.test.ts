import { describe, expect, it } from 'vitest';
import { matchSettingsTabs, parseSettingsSearch } from './sections';

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

describe('matchSettingsTabs', () => {
  it('finds the tab that owns a setting by keyword', () => {
    expect(matchSettingsTabs('gst')).toEqual(['billing']);
    expect(matchSettingsTabs('whatsapp')).toEqual(['booking']);
    expect(matchSettingsTabs('  Backup ')).toEqual(['account']);
  });

  it('returns nothing for an empty or unknown query', () => {
    expect(matchSettingsTabs('')).toEqual([]);
    expect(matchSettingsTabs('zzzz')).toEqual([]);
  });
});
