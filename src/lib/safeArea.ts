import { shouldShowPhoneAppHeader } from '@/app/phoneChrome';

/** Tailwind classes for `<main>` top padding: safe-area when the phone app header is hidden. */
export function mainContentTopPadding(pathname: string): string {
  return shouldShowPhoneAppHeader(pathname)
    ? 'pt-3 sm:pt-6'
    : 'max-sm:pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-6';
}

/** Horizontal padding respecting left/right safe areas (notch / home indicator sides). */
export const MAIN_SAFE_HORIZONTAL = 'pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]';