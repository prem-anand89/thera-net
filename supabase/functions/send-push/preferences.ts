// Which push alerts a person can switch off, and which push kinds belong to which switch.
// Dependency-free on purpose: the send-push edge function and the app's settings screen
// both import this one file, so the mapping cannot drift between them.

export type PushCategory = 'booking_request' | 'appointment_changes' | 'low_rating_feedback';

export const PUSH_CATEGORIES: readonly PushCategory[] = [
  'booking_request',
  'appointment_changes',
  'low_rating_feedback',
];

/** Every push kind send-push can send, and the switch that controls it. Keep in step with PushKind (templates.ts). */
export const PUSH_CATEGORY_BY_KIND = {
  appointment_confirmed: 'appointment_changes',
  appointment_rescheduled: 'appointment_changes',
  appointment_cancelled: 'appointment_changes',
  appointment_reassigned: 'appointment_changes',
  booking_request: 'booking_request',
  low_rating_feedback: 'low_rating_feedback',
} as const satisfies Record<string, PushCategory>;

export const PUSH_CATEGORY_COPY: Record<PushCategory, { label: string; description: string }> = {
  booking_request: {
    label: 'New booking requests',
    description: 'When a patient asks for an appointment through your booking page.',
  },
  appointment_changes: {
    label: 'Changes to my appointments',
    description: 'When one of your appointments is confirmed, rescheduled, cancelled or moved to someone else.',
  },
  low_rating_feedback: {
    label: 'Low-rated feedback',
    description: 'When a patient rates their visit 2 stars or lower.',
  },
};

/** The switches that apply to a person. Everyone linked to a therapist profile gets appointment alerts, whatever their role. */
export function pushCategoriesFor(role: string, hasTherapistProfile: boolean): PushCategory[] {
  const out: PushCategory[] = [];
  if (role === 'admin' || role === 'front_desk') out.push('booking_request');
  if (hasTherapistProfile) out.push('appointment_changes');
  if (role === 'admin') out.push('low_rating_feedback');
  return out;
}

/** Drops anyone who switched this alert off. Everyone is on by default, so only explicit "off" rows are passed in. */
export function withoutOptedOut(userIds: readonly string[], optedOutUserIds: readonly string[]): string[] {
  const off = new Set(optedOutUserIds);
  return userIds.filter((id) => !off.has(id));
}
