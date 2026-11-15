// HEP: the WhatsApp texts a therapist sends a patient (amendments 31, 36, 57, 77). One rule runs through all of it:
// a message carries the clinic name and the link, NEVER the PIN, the patient's name, or anything about their health.
// The PIN is told in person, read from the on-screen overlay, or printed on the sheet at the moment it is created.
import { buildWhatsAppSendUrl } from '@/lib/pdfShare';

export const HEP_PIN_PROMPT = 'Use your 4-digit PIN to unlock.';
/** The patient may be helped by a family member (older patients often use someone else's phone). */
export const HEP_CAREGIVER_LINE = 'Share this link only with the patient or the person helping them.';

/** `/p/{token}` on this app's own address (or `origin`). The token is URL-safe; it is encoded anyway. */
export function buildHepPortalUrl(token: string, origin: string = window.location.origin): string {
  return `${origin.replace(/\/+$/, '')}/p/${encodeURIComponent(token)}`;
}

/** The first message, sent while the patient is in the room (or soon after). Starts with the clinic name so it is easy to find in a chat. */
export function buildHepShareMessage(opts: { token: string; clinicName: string; origin?: string }): string {
  return [
    `${opts.clinicName}: here is your home exercise program.`,
    buildHepPortalUrl(opts.token, opts.origin),
    HEP_PIN_PROMPT,
    HEP_CAREGIVER_LINE,
  ].join('\n\n');
}

/** wa.me link to the patient's own number (country-code aware), or a contact picker when there is no number. */
export function buildHepWhatsAppShareUrl(opts: { token: string; clinicName: string; phone?: string | null; origin?: string }): string {
  return buildWhatsAppSendUrl(buildHepShareMessage(opts), opts.phone);
}

/** The "Message patient" presets (each can be edited before sending). */
export const HEP_MESSAGE_KINDS = {
  reminder: 'Reminder to do your exercises',
  how_are_you: 'How are you feeling with your exercises?',
  check_in: 'Time for a check-in with us',
  ended: 'Your program has ended. How did it go?',
  again: 'Here is your exercise program again.',
} as const;
export type HepMessageKind = keyof typeof HEP_MESSAGE_KINDS;

export function buildHepPatientMessage(kind: HepMessageKind, opts: { token: string; clinicName: string; origin?: string }): string {
  return [`${opts.clinicName}: ${HEP_MESSAGE_KINDS[kind]}`, buildHepPortalUrl(opts.token, opts.origin)].join('\n\n');
}

export function buildHepPatientMessageUrl(kind: HepMessageKind, opts: { token: string; clinicName: string; phone?: string | null; origin?: string }): string {
  return buildWhatsAppSendUrl(buildHepPatientMessage(kind, opts), opts.phone);
}
