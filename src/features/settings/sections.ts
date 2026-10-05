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

export interface SettingsCard {
  /** DOM id of the card (`SectionCard id`), also the scroll target. */
  id: string;
  title: string;
  tab: SettingsTab;
  /** Services only: which sub-view the card lives in. */
  catalogView?: CatalogViewKey;
  /** Words an admin might type to find this card. */
  keywords: string[];
}

export const SETTINGS_CARDS: SettingsCard[] = [
  { id: 'settings-card-general-profile', title: 'Clinic profile', tab: 'general', keywords: ['clinic name', 'logo', 'address', 'phone', 'email', 'walk-in', 'mrno', 'prefix', 'modules', 'contact'] },
  { id: 'settings-card-team-therapists', title: 'Therapists & team', tab: 'team', keywords: ['therapist', 'roster', 'invite', 'login', 'linked login', 'role', 'working hours', 'photo', 'staff'] },
  { id: 'settings-card-services-packages', title: 'Services & packages', tab: 'services', catalogView: 'packages', keywords: ['price', 'package', 'session', 'service', 'catalog', 'group'] },
  { id: 'settings-card-services-treatments', title: 'Treatments performed', tab: 'services', catalogView: 'treatments', keywords: ['treatment', 'manual therapy', 'exercise', 'taping', 'checklist'] },
  { id: 'settings-card-services-referrals', title: 'Referral sources', tab: 'services', catalogView: 'referrals', keywords: ['referral', 'referred by', 'source', 'doctor'] },
  { id: 'settings-card-booking-online', title: 'Booking page', tab: 'booking', keywords: ['whatsapp', 'feedback', 'google review', 'booking page', 'booking link', 'slug', 'patient messages', 'review link'] },
  { id: 'settings-card-booking-hours', title: 'Hours & closures', tab: 'booking', keywords: ['booking hours', 'hours', 'closed day', 'weekly closed', 'holiday', 'closure', 'slot', 'appointment duration'] },
  { id: 'settings-card-billing-invoicing', title: 'Billing & invoicing', tab: 'billing', keywords: ['gst', 'tax', 'invoice', 'prefix', 'upi', 'signature', 'fiscal year', 'who can bill', 'number'] },
  { id: 'settings-card-billing-partner', title: 'Partner & split', tab: 'billing', keywords: ['partner', 'split', 'revenue share', 'tds', 'hospital', 'share'] },
  { id: 'settings-card-account-plan', title: 'Your plan', tab: 'account', keywords: ['plan', 'tier', 'limit', 'seats', 'subscription'] },
  { id: 'settings-card-account-included', title: "What's included", tab: 'account', keywords: ['plan', 'features', 'included', 'tier'] },
  { id: 'settings-card-account-historical', title: 'Historical data', tab: 'account', keywords: ['import', 'historical', 'visits', 'csv', 'migrate'] },
  { id: 'settings-card-account-backup', title: 'Data backup', tab: 'account', keywords: ['backup', 'restore', 'export', 'download'] },
  { id: 'settings-card-account-danger', title: 'Danger zone', tab: 'account', keywords: ['wipe', 'delete', 'reset', 'danger', 'clear', 'delete clinic'] },
];

/** Cards whose title, keywords or tab label contain the query, in page order. */
export function matchSettingsCards(query: string): SettingsCard[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SETTINGS_CARDS.filter((card) => {
    const haystack = [card.title, SETTINGS_TAB_META[card.tab].label, ...card.keywords].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}
