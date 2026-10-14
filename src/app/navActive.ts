export type MainNavPath = '/workspace' | '/schedule' | '/ledger' | '/insights' | '/settings';
export type PhoneTabPath = '/workspace' | '/schedule' | '/ledger' | '/more';

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Header nav: matches by path only, so `?tab=` and other search params never
 *  unset the highlight (TanStack's default `.active` includes search).
 *  Patients and patient profile pages (/patients/*) highlight Ledger.
 *  Guided setup (/setup) highlights Settings. */
export function isNavActive(pathname: string, to: MainNavPath): boolean {
  if (to === '/ledger' && under(pathname, '/patients')) return true;
  if (to === '/settings' && under(pathname, '/setup')) return true;
  return under(pathname, to);
}

/** Phone bottom bar: Patients highlights Ledger; Reports, Settings and Setup are reached via More. */
export function activePhoneTab(pathname: string): PhoneTabPath | null {
  if (under(pathname, '/workspace')) return '/workspace';
  if (under(pathname, '/schedule')) return '/schedule';
  if (under(pathname, '/ledger') || under(pathname, '/patients')) return '/ledger';
  if (['/more', '/settings', '/setup', '/insights'].some((p) => under(pathname, p))) return '/more';
  return null;
}

const PAGE_TITLES: [string, string][] = [
  ['/workspace', 'Workspace'],
  ['/schedule', 'Schedule'],
  ['/ledger', 'Ledger'],
  ['/patients', 'Patients'],
  ['/insights', 'Reports'],
  ['/settings', 'Settings'],
  ['/setup', 'Setup'],
  ['/visits/new', 'New visit'],
  ['/more', 'More'],
];

/** Shown in the phone header, where no nav labels are visible. */
export function pageTitleFor(pathname: string): string | null {
  return PAGE_TITLES.find(([prefix]) => under(pathname, prefix))?.[1] ?? null;
}
