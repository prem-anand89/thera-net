/**
 * What the signed-in user may do to a saved visit — mirrors the database policies (visits / lines /
 * shares): admin and front desk may correct any visit, a therapist only their own (as the visit's
 * primary); an assisting therapist who isn't the primary can change nothing. Deleting stays admin or
 * the primary, and only before invoicing. Display-level only; RLS is the real boundary.
 */
export function visitPermissions(args: {
  isAdmin: boolean;
  isFrontDesk: boolean;
  myTherapistId: string | undefined;
  visitTherapistId: string;
  invoiced: boolean;
}): { canModify: boolean; canDelete: boolean; isOwn: boolean } {
  const isOwn = Boolean(args.myTherapistId) && args.visitTherapistId === args.myTherapistId;
  return {
    canModify: args.isAdmin || args.isFrontDesk || isOwn,
    canDelete: !args.invoiced && (args.isAdmin || isOwn),
    isOwn,
  };
}
