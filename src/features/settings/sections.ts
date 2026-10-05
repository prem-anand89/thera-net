/**
 * The one list of Settings tabs. The router validates `?tab=` against it and
 * SettingsPage renders from it, so the two can't drift apart. Kept free of
 * React so the route file can import it.
 */
export const SETTINGS_TABS = ['general', 'team', 'services', 'booking', 'billing', 'account'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const CATALOG_VIEWS = ['packages', 'treatments', 'referrals'] as const;
export type CatalogViewKey = (typeof CATALOG_VIEWS)[number];

export const SETTINGS_TAB_META: Record<SettingsTab, { label: string; description: string }> = {
  general: { label: 'General', description: 'Clinic name, logo, address and contact details.' },
  team: { label: 'Team', description: 'Therapists, invites and who can sign in.' },
  services: { label: 'Services', description: 'Treatments, packages and referral sources.' },
  booking: { label: 'Booking', description: 'Your online booking page, patient messages and closed days.' },
  billing: { label: 'Billing', description: 'Invoices, GST, UPI and partner revenue split.' },
  account: { label: 'Account', description: 'Your plan, data import, backup and clinic deletion.' },
};

/** Tab values from before the 6-section layout. Old links, bookmarks and
 *  saved setup steps keep landing in the right place. */
const LEGACY_TABS: Record<string, { tab: SettingsTab; catalogView?: CatalogViewKey }> = {
  profile: { tab: 'general' },
  patientComms: { tab: 'booking' },
  partner: { tab: 'billing' },
  catalog: { tab: 'services' },
  plan: { tab: 'account' },
  data: { tab: 'account' },
  // Pre-catalog-merge names.
  treatments: { tab: 'services', catalogView: 'treatments' },
  referrals: { tab: 'services', catalogView: 'referrals' },
};

export interface SettingsSearch {
  tab?: SettingsTab;
  catalogView?: CatalogViewKey;
}

export function parseSettingsSearch(search: Record<string, unknown>): SettingsSearch {
  const rawTab = typeof search.tab === 'string' ? search.tab : undefined;
  const rawView =
    typeof search.catalogView === 'string' && (CATALOG_VIEWS as readonly string[]).includes(search.catalogView)
      ? (search.catalogView as CatalogViewKey)
      : undefined;

  const legacy = rawTab ? LEGACY_TABS[rawTab] : undefined;
  const tab = legacy
    ? legacy.tab
    : rawTab && (SETTINGS_TABS as readonly string[]).includes(rawTab)
      ? (rawTab as SettingsTab)
      : undefined;
  if (!tab) return {};

  const catalogView = rawView ?? legacy?.catalogView;
  return catalogView && tab === 'services' ? { tab, catalogView } : { tab };
}

/** Words a clinic admin is likely to type when looking for a setting. Each
 *  entry points at the tab that owns it; the search matches the tab label,
 *  its description and these keywords. */
export const SETTINGS_KEYWORDS: Record<SettingsTab, string[]> = {
  general: ['clinic name', 'logo', 'address', 'phone', 'email', 'walk-in', 'mrno', 'prefix', 'modules'],
  team: ['therapist', 'roster', 'invite', 'login', 'linked login', 'role', 'working hours', 'photo'],
  services: ['price', 'package', 'session', 'treatment', 'referral', 'catalog', 'service'],
  booking: ['whatsapp', 'feedback', 'google review', 'closed day', 'holiday', 'booking page', 'slug'],
  billing: ['gst', 'tax', 'invoice', 'prefix', 'upi', 'signature', 'fiscal year', 'tds', 'partner', 'split'],
  account: ['plan', 'backup', 'restore', 'import', 'historical', 'wipe', 'delete', 'danger'],
};

/** Tabs whose label, description or keywords contain the query, in tab order. */
export function matchSettingsTabs(query: string): SettingsTab[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SETTINGS_TABS.filter((tab) => {
    const meta = SETTINGS_TAB_META[tab];
    const haystack = [meta.label, meta.description, ...SETTINGS_KEYWORDS[tab]].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}
