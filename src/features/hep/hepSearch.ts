// The /hep route's search shape, kept apart from the page so the router can import it without loading the page.
export const HEP_TABS = ['library', 'templates', 'programs'] as const;
export type HepTab = (typeof HEP_TABS)[number];
export interface HepSearch { tab?: HepTab }

export function validateHepSearch(search: Record<string, unknown>): HepSearch {
  return typeof search.tab === 'string' && (HEP_TABS as readonly string[]).includes(search.tab) ? { tab: search.tab as HepTab } : {};
}
