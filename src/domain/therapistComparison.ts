/**
 * Who sees the therapist comparison (Reports section, its jump-nav pill, the printable trends review): an admin, on a
 * plan that includes the revenue split, in a clinic with two or more active therapists. There is no setting: one
 * therapist has nobody to compare against, and therapists never see colleagues' revenue. The old
 * `clinics.show_therapist_comparison` column is no longer read.
 */
export function showsTherapistComparison({
  isAdmin,
  hasRevenueSplit,
  activeTherapistCount,
}: {
  isAdmin: boolean;
  hasRevenueSplit: boolean;
  activeTherapistCount: number;
}): boolean {
  return isAdmin && hasRevenueSplit && activeTherapistCount >= 2;
}
