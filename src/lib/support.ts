/**
 * Where a clinic goes to move to a bigger plan. There is no self-serve
 * checkout yet, so this is a mail link; set VITE_SUPPORT_EMAIL (Vercel →
 * Environment Variables) to turn it on. Unset, callers show plain text.
 */
export function upgradeMailto(clinicName: string, tierLabel: string): string | null {
  const email = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim();
  if (!email) return null;
  const subject = encodeURIComponent(`Upgrade request: ${clinicName}`);
  const body = encodeURIComponent(`Hello, we are on the ${tierLabel} plan and would like to upgrade ${clinicName}.`);
  return `mailto:${email}?subject=${subject}&body=${body}`;
}
