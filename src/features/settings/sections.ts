/**
 * The one list of Settings tabs. The router validates `?tab=` against it and
 * SettingsPage renders from it, so the two can't drift apart. Kept free of
 * React so the route file can import it.
 */
export const SETTINGS_TABS = ['general', 'team', 'services', 'booking', 'billing', 'account'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** The two lists on the Services & treatments tab. (Referral sources moved to General: see `card` below.) */
export const CATALOG_VIEWS = ['packages', 'treatments'] as const;
export type CatalogViewKey = (typeof CATALOG_VIEWS)[number];

/** The Team tab's two views: the people, and their shifts. */
export const TEAM_VIEWS = ['members', 'shifts'] as const;
export type TeamViewKey = (typeof TEAM_VIEWS)[number];

export const SETTINGS_TAB_META: Record<SettingsTab, { label: string; description: string }> = {
  general: { label: 'General', description: 'Clinic profile, region, what happens after a visit, and referral sources.' },
  team: { label: 'Team', description: 'Therapists, invites and who can sign in.' },
  services: { label: 'Services & treatments', description: 'What patients pay for, and what you record doing in each session.' },
  booking: { label: 'Schedule & Booking', description: 'Clinic hours, closed days and holidays, your online booking page and patient messages.' },
  billing: { label: 'Payments & billing', description: 'How patients pay, invoices and GST, and partner revenue split.' },
  account: { label: 'Account', description: 'Your plan, data import, backup and clinic deletion.' },
};

/** Tab values from before the 6-section layout. Old links, bookmarks and
 *  saved setup steps keep landing in the right place. */
const LEGACY_TABS: Record<string, { tab: SettingsTab; catalogView?: CatalogViewKey; card?: SettingsCardKey }> = {
  profile: { tab: 'general' },
  patientComms: { tab: 'booking' },
  partner: { tab: 'billing' },
  catalog: { tab: 'services' },
  plan: { tab: 'account' },
  data: { tab: 'account' },
  // Pre-catalog-merge names.
  treatments: { tab: 'services', catalogView: 'treatments' },
  // Referral sources moved to General (a card on its own, still called "Referral sources").
  referrals: { tab: 'general', card: 'referrals' },
};

/** A card a link can scroll to on landing. */
export type SettingsCardKey = 'referrals' | 'after-visit';
export const REFERRALS_CARD_ID = 'settings-card-general-referrals';
export const AFTER_VISIT_CARD_ID = 'settings-card-after-visit';

export interface SettingsSearch {
  tab?: SettingsTab;
  catalogView?: CatalogViewKey;
  /** Open the tab and scroll to this card: lands on the card with a highlight. */
  card?: SettingsCardKey;
  /** Team only: which view opens. Absent means Team members. */
  teamView?: TeamViewKey;
  fromSetup?: boolean;
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
  const fromSetup = search.fromSetup === true || search.fromSetup === 'true' ? true : undefined;
  // Referral sources used to be a view of the Services tab: `?catalogView=referrals` (with or without a tab) and the
  // old `?tab=referrals` all land on General at the card.
  if (search.catalogView === 'referrals' || legacy?.card === 'referrals' || search.card === 'referrals') {
    return fromSetup ? { tab: 'general', card: 'referrals', fromSetup } : { tab: 'general', card: 'referrals' };
  }
  if (search.card === 'after-visit') {
    return fromSetup ? { tab: 'general', card: 'after-visit', fromSetup } : { tab: 'general', card: 'after-visit' };
  }
  if (!tab) return search.fromSetup ? { fromSetup: true } : {};

  const catalogView = rawView ?? legacy?.catalogView;
  const teamView =
    typeof search.teamView === 'string' && (TEAM_VIEWS as readonly string[]).includes(search.teamView)
      ? (search.teamView as TeamViewKey)
      : undefined;

  if (catalogView && tab === 'services') return { tab, catalogView, fromSetup };
  if (teamView && tab === 'team') return fromSetup ? { tab, teamView, fromSetup } : { tab, teamView };
  return fromSetup ? { tab, fromSetup } : { tab };
}

export interface SettingsCard {
  /** DOM id of the card (`SectionCard id`), also the scroll target. */
  id: string;
  title: string;
  tab: SettingsTab;
  /** Services & treatments only: which list the card lives in. */
  catalogView?: CatalogViewKey;
  /** Team only: which view the card lives in. */
  teamView?: TeamViewKey;
  /** Words an admin might type to find this card. */
  keywords: string[];
}

export const SETTINGS_CARDS: SettingsCard[] = [
  { id: 'settings-card-general-profile', title: 'Clinic profile', tab: 'general', keywords: ['clinic name', 'logo', 'signature', 'address', 'phone', 'email', 'contact', 'clinic code', 'prefix', 'invoice prefix', 'patient id', 'walk-in', 'mrno'] },
  { id: 'settings-card-region', title: 'Region and daily email', tab: 'general', keywords: ['region', 'time zone', 'timezone', 'country code', 'phone country', 'financial year', 'fiscal year', 'daily agenda', 'agenda email', 'evening email'] },
  { id: 'settings-card-after-visit', title: 'After a visit', tab: 'general', keywords: ['clinical notes', 'notes', 'clinical', 'soap', 'documentation', 'consultation', 'feedback', 'patient feedback', 'google review', 'review link', 'rating'] },
  { id: 'settings-card-care-locations', title: 'Where you see patients', tab: 'general', keywords: ['home visit', 'home care', 'home', 'clinic', 'inpatient', 'location', 'address', 'domiciliary'] },
  { id: REFERRALS_CARD_ID, title: 'Referral sources', tab: 'general', keywords: ['referral', 'referrals', 'referral sources', 'how patients found you', 'found you', 'referred by', 'source', 'doctor', 'word of mouth', 'walk-in'] },
  { id: 'settings-card-team-therapists', title: 'Team members', tab: 'team', teamView: 'members', keywords: ['therapist', 'roster', 'invite', 'login', 'linked login', 'role', 'working hours', 'photo', 'staff'] },
  { id: 'settings-card-team-shifts', title: 'Working hours', tab: 'team', teamView: 'shifts', keywords: ['shift', 'shift type', 'shift template', 'coverage', 'weekly shifts', 'own hours', 'roster', 'break', 'shift request', 'swap'] },
  { id: 'settings-card-services-packages', title: 'Services and prices', tab: 'services', catalogView: 'packages', keywords: ['services', 'service', 'prices', 'price', 'price list', 'package', 'session', 'catalog', 'group', 'fees'] },
  { id: 'settings-card-services-treatments', title: 'Treatments', tab: 'services', catalogView: 'treatments', keywords: ['treatments', 'treatment', 'manual therapy', 'exercise', 'taping', 'checklist', 'quick picks'] },
  { id: 'settings-card-booking-hours', title: 'Hours & closures', tab: 'booking', keywords: ['booking hours', 'hours', 'opening hours', 'open days', 'closed day', 'holiday', 'closure', 'split', 'lunch', 'break', 'different hours', 'staff can book outside', 'appointment duration'] },
  { id: 'settings-card-booking-online', title: 'Online booking page', tab: 'booking', keywords: ['whatsapp', 'booking page', 'booking link', 'slug', 'patient messages', 'online booking', 'public booking'] },
  { id: 'settings-card-payments', title: 'Payments', tab: 'billing', keywords: ['payment', 'upi', 'qr', 'vpa', 'upi id', 'scan to pay', 'payee', 'collect'] },
  { id: 'settings-card-billing-invoicing', title: 'Invoicing', tab: 'billing', keywords: ['gst', 'gstin', 'invoice', 'receipt', 'who can bill', 'who can issue', 'bill'] },
  { id: 'settings-card-billing-partner', title: 'Partner revenue share', tab: 'billing', keywords: ['partner', 'split', 'revenue share', 'tds', 'tax', 'hospital', 'share', 'collects', 'collected by', 'partner logo', 'partner name'] },
  { id: 'settings-card-account-plan', title: 'Your plan', tab: 'account', keywords: ['plan', 'tier', 'limit', 'seats', 'subscription'] },
  { id: 'settings-card-account-included', title: "What's included", tab: 'account', keywords: ['plan', 'features', 'included', 'tier'] },
  { id: 'settings-card-account-historical', title: 'Import Historical Data', tab: 'account', keywords: ['import', 'historical', 'visits', 'csv', 'migrate'] },
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
