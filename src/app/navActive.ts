export type MainNavPath = '/workspace' | '/schedule' | '/ledger' | '/patients' | '/insights';
export type PhoneTabPath = '/workspace' | '/schedule' | '/ledger' | '/more';

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Header nav: matches by path only, so `?tab=` and other search params never
 *  unset the highlight (TanStack's default `.active` includes search). */
export function isNavActive(pathname: string, to: MainNavPath): boolean {
  return under(pathname, to);
}

/** Settings and Guided Setup live in the account menu on larger screens. */
export function isAccountAreaActive(pathname: string): boolean {
  return under(pathname, '/settings') || under(pathname, '/setup');
}

/** Phone bottom bar: Patients, Reports, Settings and Setup are reached via More. */
export function activePhoneTab(pathname: string): PhoneTabPath | null {
  if (under(pathname, '/workspace')) return '/workspace';
  if (under(pathname, '/schedule')) return '/schedule';
  if (under(pathname, '/ledger')) return '/ledger';
  if (['/more', '/settings', '/setup', '/insights', '/patients'].some((p) => under(pathname, p))) return '/more';
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
