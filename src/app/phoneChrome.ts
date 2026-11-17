/**
 * Phone-specific Shell chrome: which global nav/header strips show for a route.
 */

export function shouldShowPhoneBottomNav(pathname: string): boolean {
  return pathname !== '/visits/new' && !pathname.startsWith('/onboarding');
}

export function shouldShowPhoneAppHeader(pathname: string): boolean {
  return pathname !== '/visits/new';
}

/** Print/document routes render standalone without the app header or bottom nav. */
export function isChromelessPrintRoute(pathname: string): boolean {
  return (
    pathname.endsWith('/print') ||
    pathname.endsWith('/slip') ||
    pathname === '/insights/trends-print' ||
    pathname.includes('/session-log/') ||
    pathname.includes('/insurer-packet/')
  );
}