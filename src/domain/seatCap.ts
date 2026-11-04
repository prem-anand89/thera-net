/**
 * "Every login the plan includes is in use": the plan is enforced, loaded, and the seats taken have reached its limit.
 * Unknown seat counts read as not full (the server's trigger is the backstop). One definition for Settings → Team, the
 * landing tab and the setup checklist.
 */
export function atSeatCap(
  entitlements: { enforcementEnabled: boolean; loading: boolean; maxMembers: number },
  seatsUsed: number | null | undefined
): boolean {
  return entitlements.enforcementEnabled && !entitlements.loading && seatsUsed != null && seatsUsed >= entitlements.maxMembers;
}
