export type WorkspaceViewChoice = 'all' | 'mine';

/** An id that matches no therapist: a narrowed query using it finds nothing (see `useWorkspaceScope`). */
export interface WorkspaceViewScope {
  /** Admin or front desk: sees the whole clinic by default. */
  isClinicWideView: boolean;
  /** This login's own therapist row, if linked. */
  myTherapistId: string | undefined;
  /** From `useWorkspaceScope`: undefined for the clinic-wide roles, else the therapist's id (or a never-matching id). */
  scopeTherapistId: string | undefined;
}

export interface WorkspaceView {
  /** The All | Mine switch is offered: only to someone with a therapist row of their own. */
  canToggle: boolean;
  /** What the sections below the switch are narrowed to. */
  mineOnly: boolean;
  /** Query filter for those sections: undefined = whole clinic, else one therapist (a never-matching id while unresolved). */
  viewTherapistId: string | undefined;
}

/**
 * Whose work the Workspace sections show. Derived on every render from the role and the person's own choice, never
 * stored as an initial value, so it is right once the role and therapist list have loaded: a therapist opens on Mine,
 * an admin or front desk on All, and a therapist with no linked row (or a role still loading) is narrowed to nothing
 * rather than shown the whole clinic.
 */
export function resolveWorkspaceView(scope: WorkspaceViewScope, choice: WorkspaceViewChoice | null): WorkspaceView {
  const canToggle = Boolean(scope.myTherapistId);
  const defaultChoice: WorkspaceViewChoice = scope.isClinicWideView ? 'all' : 'mine';
  const mineOnly = canToggle ? (choice ?? defaultChoice) === 'mine' : !scope.isClinicWideView;
  return {
    canToggle,
    mineOnly,
    viewTherapistId: mineOnly ? (scope.myTherapistId ?? scope.scopeTherapistId) : undefined,
  };
}
