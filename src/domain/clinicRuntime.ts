/**
 * The signed-in clinic's phone country, published once by `Shell.tsx` so plain code with no React context
 * (WhatsApp links) can read it. Absent or blank means India, so nothing changes for an Indian clinic.
 */
let country = '+91';

export function setClinicRuntime(next: { countryCode?: string | null }): void {
  country = next.countryCode || '+91';
}
export const activeCountryCode = (): string => country;
