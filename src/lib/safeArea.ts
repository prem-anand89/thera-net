import { shouldShowPhoneAppHeader } from '@/app/phoneChrome';

/** Tailwind classes for `<main>` top padding: safe-area when the phone app header is hidden. */
export function mainContentTopPadding(pathname: string): string {
  return shouldShowPhoneAppHeader(pathname)
    ? 'pt-3 sm:pt-6'
    : 'max-sm:pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-6';
}

/** Horizontal padding respecting left/right safe areas (notch / home indicator sides). */
export const MAIN_SAFE_HORIZONTAL = 'pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]';

/** Standalone print toolbar padding: keeps Back/Print clear of the iOS status bar / Dynamic Island. */
export const PRINT_TOOLBAR_SAFE =
  'pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]';

/** Full-page fallback (loading/error) padding on chromeless print routes. */
export const PRINT_EARLY_RETURN_SAFE =
  'pt-[max(2rem,env(safe-area-inset-top))] pb-8 pl-[max(2rem,env(safe-area-inset-left))] pr-[max(2rem,env(safe-area-inset-right))]';

/** Ensures print Back links meet 44px touch height on phones without changing tablet/desktop pills. */
export const PRINT_BACK_TOUCH = 'max-sm:min-h-11 max-sm:inline-flex max-sm:items-center';