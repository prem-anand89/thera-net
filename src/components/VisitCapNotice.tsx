import { useClinic } from '@/app/clinicContext';
import { useEntitlements } from '@/app/useEntitlements';
import { PLAN_TIER_LABELS, visitCapStatus } from '@/domain/plans';
import { upgradeMailto } from '@/lib/support';

/**
 * Heads-up for a clinic close to (or at) its monthly visit cap, so the block
 * on saving the next visit is never a surprise. Renders nothing when the plan
 * has no cap, enforcement is paused, or usage is under 80%.
 */
export function VisitCapNotice() {
  const clinic = useClinic();
  const { tier, visitCapPerMonth, visitsThisMonth, enforcementEnabled, loading } = useEntitlements(clinic.id);
  if (loading || !enforcementEnabled) return null;
  const status = visitCapStatus(visitsThisMonth, visitCapPerMonth);
  if (status === 'ok' || visitCapPerMonth == null) return null;

  const href = upgradeMailto(clinic.name, PLAN_TIER_LABELS[tier]);
  const reached = status === 'reached';
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ${reached ? 'bg-[var(--rust-light)] text-[var(--rust)]' : 'bg-[var(--teal-light)] text-[var(--teal-strong)]'}`}
    >
      <span>
        {reached ? (
          <>
            <strong>
              {visitsThisMonth} of {visitCapPerMonth}
            </strong>{' '}
            visits used — this month's limit is reached. Visits can be logged again next month, or after an upgrade.
          </>
        ) : (
          <>
            <strong>
              {visitsThisMonth} of {visitCapPerMonth}
            </strong>{' '}
            visits used this month on the {PLAN_TIER_LABELS[tier]} plan.
          </>
        )}
      </span>
      {href ? (
        <a href={href} className="text-xs font-medium underline hover:no-underline">
          Ask to upgrade
        </a>
      ) : (
        <span className="text-xs">Contact us to upgrade.</span>
      )}
    </div>
  );
}
