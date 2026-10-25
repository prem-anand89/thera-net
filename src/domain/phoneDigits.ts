/**
 * The last 10 digits of a phone number: the part that identifies a person whatever country code or
 * punctuation came with it ("+91 98765 43210" and "09876543210" both end in 9876543210). The one place
 * numbers are compared, so patients, appointments and look-alike checks never disagree about a match.
 */
export const lastTenDigits = (value: string | null | undefined): string => (value ?? '').replace(/\D/g, '').slice(-10);
