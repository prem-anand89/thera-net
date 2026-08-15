import { useWorkspaceScope } from './useWorkspaceScope';

export interface Permissions {
  role: 'admin' | 'therapist' | 'front_desk' | 'unknown';
  isAdmin: boolean;
  /** Editing clinic profile/billing config/features, and the therapist/service roster. */
  canEditSettings: boolean;
  /** Inviting, revoking, and changing the role of team members. */
  canManageTeam: boolean;
  /** Payout- and settlement-shaped aggregates — a colleague's earnings, not a per-visit bill amount. */
  canViewPayouts: boolean;
  /** Clinical consultation notes — reception has no clinical-documentation need. */
  canViewClinicalNotes: boolean;
}

/**
 * Single source of truth for "can this signed-in user do X", computed once
 * from role rather than each screen re-deriving its own `scope.isAdmin`
 * check. Display-level gating only, same caveat as `useClinicRole` — RLS is
 * the real boundary for anything these booleans guard that also has a
 * server-side policy (settings tables, therapist/catalog writes). Screens
 * that need "clinic-wide vs. mine" data scoping rather than a permission
 * check should use `useWorkspaceScope`'s `isClinicWideView` instead — that's
 * a different question from what this hook answers.
 */
export function usePermissions(): Permissions {
  const scope = useWorkspaceScope();
  return {
    role: scope.role,
    isAdmin: scope.isAdmin,
    canEditSettings: scope.isAdmin,
    canManageTeam: scope.isAdmin,
    canViewPayouts: scope.isAdmin,
    canViewClinicalNotes: !scope.isFrontDesk,
  };
}
