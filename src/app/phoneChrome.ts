/**
 * Phone-specific Shell chrome: which global nav/header strips show for a route.
 */

export function shouldShowPhoneBottomNav(pathname: string): boolean {
  return pathname !== '/visits/new' && !pathname.startsWith('/onboarding');
}

export function shouldShowPhoneAppHeader(pathname: string): boolean {
  return pathname !== '/visits/new';
}