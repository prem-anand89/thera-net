import { useClinic } from './clinicContext';
import { useWorkspaceScope } from './useWorkspaceScope';
import { useEntitlements } from './useEntitlements';

export interface Permissions {
  role: 'admin' | 'therapist' | 'front_desk' | 'unknown';
  isAdmin: boolean;
  /** Editing clinic profile/billing config/features, and the therapist/service roster. */
  canEditSettings: boolean;
  /**
   * Payout- and settlement-shaped aggregates — a colleague's earnings, not
   * a per-visit bill amount. Gates Ledger's Reports sub-tab (the full
   * per-therapist Bill/BM Share/TDS/Post-Tax/HV monthly breakdown).
   */
  canViewPayouts: boolean;
  /** Clinical consultation notes — reception has no clinical-documentation need. */
  canViewClinicalNotes: boolean;
  /**
   * Issuing invoices / collecting payment at point of care. False for
   * everyone when `clinic.billingEnabled` is off (the clinic doesn't use
   * the module at all); otherwise false for a plain therapist when
   * `clinic.invoicingAccess` is 'billing_staff'. Display-level only — the
   * real boundary is `issue_invoice()`'s own check on the same two fields.
   */
  canBill: boolean;
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
  const clinic = useClinic();
  const scope = useWorkspaceScope();
  const entitlements = useEntitlements(clinic.id);
  const billingEnabled = clinic.billingEnabled ?? true;
  const invoicingAccess = clinic.invoicingAccess ?? 'everyone';
  return {
    role: scope.role,
    isAdmin: scope.isAdmin,
    canEditSettings: scope.isAdmin,
    // Attribution Audit is a Clinic/Clinic+ feature regardless of role —
    // an admin on Lite/Solo doesn't get it either.
    canViewPayouts: scope.isAdmin && entitlements.can('revenueSplit'),
    canViewClinicalNotes: !scope.isFrontDesk,
    // Plan tier is the outermost gate (a Lite clinic can't bill no matter
    // what billingEnabled/invoicingAccess say — see issue_invoice()'s own
    // precedence), then the two existing clinic-owned preferences.
    canBill:
      entitlements.can('invoicing') &&
      billingEnabled &&
      (invoicingAccess === 'everyone' || scope.isAdmin || scope.isFrontDesk),
  };
}
