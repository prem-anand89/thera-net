export interface UpgradeDetails {
  clinicId?: string;
  /** What they are using, e.g. "47 of 50 visits this month, 1 of 1 login". Helps whoever answers act without asking back. */
  usage?: string;
}

/** The mail link itself, with the clinic, tier, id and usage in the body. Pure, so the text is tested. */
export function buildUpgradeMailto(email: string, clinicName: string, tierLabel: string, details: UpgradeDetails = {}): string {
  const subject = encodeURIComponent(`Upgrade request: ${clinicName}`);
  const lines = [
    `Hello, we are on the ${tierLabel} plan and would like to upgrade ${clinicName}.`,
    '',
    `Clinic: ${clinicName}`,
    ...(details.clinicId ? [`Clinic ID: ${details.clinicId}`] : []),
    `Current plan: ${tierLabel}`,
    ...(details.usage ? [`Usage: ${details.usage}`] : []),
  ];
  return `mailto:${email}?subject=${subject}&body=${encodeURIComponent(lines.join('\n'))}`;
}

/**
 * Where a clinic goes to move to a bigger plan. There is no self-serve
 * checkout yet, so this is a mail link; set VITE_SUPPORT_EMAIL (Vercel →
 * Environment Variables) to turn it on. Unset, callers show plain text.
 */
export function upgradeMailto(clinicName: string, tierLabel: string, details?: UpgradeDetails): string | null {
  const email = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim();
  if (!email) return null;
  return buildUpgradeMailto(email, clinicName, tierLabel, details);
}
