import { useClinic } from '@/app/clinicContext';
import { useEntitlements } from '@/app/useEntitlements';
import { PLAN_TIER_LABELS, minimumTierFor, type PlanFeature } from '@/domain/plans';
import { SectionCard, Pill, StatTile } from '@/components/ui';
import { VisitCapNotice } from '@/components/VisitCapNotice';

const PLAN_STATUS_LABELS: Record<'active' | 'past_due' | 'read_only', string> = {
  active: 'Active',
  past_due: 'Past due',
  read_only: 'Read-only',
};

/** Read-only — nothing here is admin-editable, matching the server model
 *  (clinic_plans has no write policy at all; see Phase 0 of the tier plan). */
export function PlanSection() {
  const clinic = useClinic();
  const entitlements = useEntitlements(clinic.id);
  const {
    tier,
    status,
    maxMembers,
    visitCapPerMonth,
    seatsUsed,
    visitsThisMonth,
    loading,
    enforcementEnabled,
  } = entitlements;
  const statusTone = status === 'active' ? 'green' : status === 'read_only' ? 'amber' : 'slate';
  const features: { key: PlanFeature; label: string }[] = [
    { key: 'invoicing', label: 'Billing & invoicing' },
    { key: 'team', label: 'Multiple team logins' },
    { key: 'revenueSplit', label: 'Hospital revenue split & attribution audit' },
    { key: 'advancedModules', label: 'Advanced assessment modules' },
    { key: 'notePrinting', label: 'Print / PDF of notes' },
  ];

  return (
    <div className="space-y-4">
      <SectionCard id="settings-card-account-plan" title="Your plan">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-display text-lg font-semibold text-[var(--ink)]">
            {loading ? '…' : PLAN_TIER_LABELS[tier]}
          </span>
          {!loading && <Pill tone={statusTone}>{PLAN_STATUS_LABELS[status]}</Pill>}
        </div>
        {!loading && !enforcementEnabled && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Tier limits are paused for pilot testing — every plan currently has full access
            regardless of what's shown below.
          </p>
        )}
        {status === 'read_only' && (
          <p className="mt-2 text-xs text-[var(--rust)]">
            New visits, invoices, and patients are on hold until payment resumes. Existing records
            stay fully visible.
          </p>
        )}
        <div className="mt-3">
          <VisitCapNotice />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:w-fit sm:grid-cols-2">
          <StatTile
            label="Seats"
            value={seatsUsed == null ? `— / ${maxMembers}` : `${seatsUsed} / ${maxMembers}`}
          />
          <StatTile
            label="Visits this month"
            value={
              visitCapPerMonth == null
                ? `${visitsThisMonth}`
                : `${visitsThisMonth} / ${visitCapPerMonth}`
            }
          />
        </div>
      </SectionCard>
      <SectionCard id="settings-card-account-included" title="What's included">
        <ul className="divide-y divide-[var(--border)]">
          {features.map((f) => (
            <li
              key={f.key}
              className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0"
            >
              <span className="text-[var(--ink)]">{f.label}</span>
              {entitlements.can(f.key) ? (
                <Pill tone="green">Included</Pill>
              ) : (
                <span className="text-right text-xs text-[var(--muted)]">
                  Included in {PLAN_TIER_LABELS[minimumTierFor(f.key)]} and above
                </span>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
