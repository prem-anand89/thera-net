/**
 * Name checks for the clinic's own lists: services, treatments and referral sources (and service group names).
 *
 * Why this exists: the database has `unique (clinic_id, name)` on all three lists. The app saves on the device first,
 * so a duplicate name would look saved and then fail to sync and stay stuck. Every way of adding or renaming checks the
 * name here first (the screens to explain, `catalogService` as the safety net).
 *
 * - **exact**: the same name as an offered item, ignoring capitals and surrounding spaces. Blocks.
 * - **hidden**: the same name as a hidden / no-longer-offered item. Blocks, and the screen offers to switch it back on.
 * - **similar**: the same once spaces, hyphens, punctuation and a trailing "s" are ignored (Assessment / Assessments,
 *   Follow up / Follow-up). Only a prompt; never blocks. Abbreviations (CST / Craniosacral) are not caught.
 */

export type NameCheckKind = 'exact' | 'hidden' | 'similar' | 'none';

export interface NamedItem {
  id: string;
  name: string;
  active: boolean;
}

export interface NameCheckResult<T extends NamedItem = NamedItem> {
  kind: NameCheckKind;
  match: T | null;
}

/** Capitals and surrounding spaces ignored: the comparison that decides "the same name". */
export function sameNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Spaces, hyphens, punctuation and a trailing "s" also ignored: the comparison for "very like". */
export function looseNameKey(name: string): string {
  return sameNameKey(name).replace(/[^a-z0-9]/g, '').replace(/s$/, '');
}

/** True when the check should stop the save. */
export function nameCheckBlocks(result: Pick<NameCheckResult, 'kind'>): boolean {
  return result.kind === 'exact' || result.kind === 'hidden';
}

/**
 * Checks `name` against the list. `selfId` is the item being renamed: it is never compared with itself, and saving it
 * under its own unchanged name never triggers a check (so a clinic that already has a case-only pair can still edit
 * both rows).
 */
export function nameCheck<T extends NamedItem>(
  name: string,
  items: readonly T[],
  opts: { selfId?: string } = {}
): NameCheckResult<T> {
  const none: NameCheckResult<T> = { kind: 'none', match: null };
  const key = sameNameKey(name);
  if (!key) return none;
  const self = opts.selfId ? items.find((i) => i.id === opts.selfId) : undefined;
  if (self && self.name.trim() === name.trim()) return none;
  const others = items.filter((i) => i.id !== opts.selfId);

  const same = others.filter((i) => sameNameKey(i.name) === key);
  const offered = same.find((i) => i.active);
  if (offered) return { kind: 'exact', match: offered };
  if (same.length > 0) return { kind: 'hidden', match: same[0] };

  const loose = looseNameKey(name);
  if (!loose) return none;
  const like = others.filter((i) => looseNameKey(i.name) === loose);
  const likeOffered = like.find((i) => i.active) ?? like[0];
  return likeOffered ? { kind: 'similar', match: likeOffered } : none;
}

export interface GroupNameCheckResult {
  /** `exact`: the group already exists (use its spelling); `similar`: one very like it exists. */
  kind: 'exact' | 'similar' | 'none';
  match: string | null;
}

/**
 * Service group names are not stored rows, just the `category` on each service, so a match never blocks: an exact match
 * means "use the existing group" (its spelling), and a near one is offered. `current` is the group being renamed.
 */
export function groupNameCheck(name: string, groups: readonly string[], current?: string): GroupNameCheckResult {
  const key = sameNameKey(name);
  if (!key) return { kind: 'none', match: null };
  if (current !== undefined && current.trim() === name.trim()) return { kind: 'none', match: null };
  const others = groups.filter((g) => g !== current);
  const exact = others.find((g) => sameNameKey(g) === key);
  if (exact) return { kind: 'exact', match: exact };
  const loose = looseNameKey(name);
  const like = loose ? others.find((g) => looseNameKey(g) === loose) : undefined;
  return like ? { kind: 'similar', match: like } : { kind: 'none', match: null };
}

/** A save refused because the name is taken. Its message is written for the person, not a log. */
export class NameTakenError extends Error {
  readonly kind: 'exact' | 'hidden';
  readonly matchName: string;
  constructor(kind: 'exact' | 'hidden', matchName: string, hiddenLabel = 'is inactive') {
    super(kind === 'exact' ? `You already have ${matchName}.` : `${matchName} ${hiddenLabel}.`);
    this.name = 'NameTakenError';
    this.kind = kind;
    this.matchName = matchName;
  }
}

/** Throws {@link NameTakenError} when the name is taken; returns the check otherwise (so a near match can be shown). */
export function assertNameFree<T extends NamedItem>(
  name: string,
  items: readonly T[],
  opts: { selfId?: string; hiddenLabel?: string } = {}
): NameCheckResult<T> {
  const result = nameCheck(name, items, opts);
  if (result.match && (result.kind === 'exact' || result.kind === 'hidden')) {
    throw new NameTakenError(result.kind, result.match.name.trim(), opts.hiddenLabel);
  }
  return result;
}

/**
 * Duplicate names inside one batch (first-run setup writes all its rows at once): the first name that appears twice,
 * ignoring capitals and surrounding spaces, or null.
 */
export function firstDuplicateName(names: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const n of names) {
    const key = sameNameKey(n);
    if (!key) continue;
    if (seen.has(key)) return n.trim();
    seen.add(key);
  }
  return null;
}
