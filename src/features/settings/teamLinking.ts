import type { Therapist } from '@/domain/types';

interface LinkablePerson {
  member: unknown | null;
  therapist: Pick<Therapist, 'userId'> | null;
}

/**
 * Whether a roster therapist has no login, as far as the UI can tell.
 *
 * The roster (local Dexie) arrives long before the member list (a server call), so
 * until that list loads `member` is null for everybody and every therapist would read
 * as "no login" — an amber banner, a "Delete record" button and an Unlinked badge
 * that vanish a second later. A therapist whose roster row already carries a
 * `userId` is therefore only reported unlinked once the member list has loaded and
 * still has no matching login; one with no `userId` at all is unlinked either way.
 */
export function isUnlinked(person: LinkablePerson, membersLoaded: boolean): boolean {
  if (!person.therapist || person.member) return false;
  return membersLoaded || !person.therapist.userId;
}
