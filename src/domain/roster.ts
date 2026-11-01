import type { Therapist } from './types';

/** A team member on the schedule with no login of their own that currently counts toward the plan's limit. */
const isRosterOnly = (t: Pick<Therapist, 'active' | 'userId'>) => t.active !== false && !t.userId;

/** How many active team members without a login the clinic has. */
export function rosterUsed(therapists: readonly Pick<Therapist, 'active' | 'userId'>[]): number {
  return therapists.filter(isRosterOnly).length;
}

/**
 * Whether adding one more team member without a login (or switching an inactive one back on) would go past the
 * plan's limit. `exceptId` is the person being switched on, who must not be counted twice. `max` null = no limit.
 * Mirrors the server trigger `enforce_roster_cap`, which stays the authority; this is here so the app refuses with a
 * plain message before a rejected write can get stuck in the sync queue.
 */
export function rosterAddBlocked(
  therapists: readonly (Pick<Therapist, 'active' | 'userId'> & { id: string })[],
  max: number | null,
  exceptId?: string
): boolean {
  if (max === null) return false;
  return therapists.filter((t) => t.id !== exceptId && isRosterOnly(t)).length >= max;
}

/** More active team members without a login than the plan includes (for the "choose who stays active" banner). */
export function rosterOverLimit(therapists: readonly Pick<Therapist, 'active' | 'userId'>[], max: number | null): boolean {
  return max !== null && rosterUsed(therapists) > max;
}

export function rosterLimitMessage(max: number): string {
  return `Your plan includes ${max} team member${max === 1 ? '' : 's'} without a login, and ${max === 1 ? 'that one is' : 'they are all'} in use. Switch one off, or upgrade, to add another.`;
}
