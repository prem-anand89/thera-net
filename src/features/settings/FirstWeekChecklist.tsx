import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useClinic } from '@/app/clinicContext';
import { useEntitlements } from '@/app/useEntitlements';
import { btnSecondary } from '@/components/ui';

export const FIRST_WEEK_CHECKLIST_META_KEY = 'firstWeekChecklistDismissed';
const COMPLETED_STEPS_META_KEY = 'firstWeekChecklistCompletedSteps';

/**
 * Real setup sequence, an admin's actual order of operations — not the
 * previous version's flat list of gotcha/safety tips with no ordering
 * logic. `id`s are stable strings (not array indices), so reordering this
 * list later can't silently corrupt someone's mid-flight completion state
 * in `COMPLETED_STEPS_META_KEY`. Two steps (`invite-team`, `wait-synced`)
 * get plan-aware copy — see `buildSteps` below.
 */
interface Step {
  id: string;
  title: string;
  body: string;
}

function buildSteps(seatLimited: boolean, canInvoice: boolean): Step[] {
  return [
    {
      id: 'clinic-profile',
      title: 'Set up your clinic profile',
      body: 'Settings → Clinic profile: name, address, invoice prefix, tax %, revenue split. Everything else — every invoice, every split calculation — reads from this.',
    },
    {
      id: 'price-services',
      title: 'Price your services',
      body: 'Settings → Services. Set the catalog before logging visits; a visit billed against an unpriced service can’t invoice cleanly later.',
    },
    {
      id: 'invite-team',
      title: 'Invite your team',
      body: seatLimited
        ? 'Your plan allows 1 login for now — invite a teammate once you upgrade. If it’s a shared reception PC, still sign out at the end of every shift so the next person doesn’t see this login’s data.'
        : 'Settings → Team → Invite. Each person needs their own login, not shared credentials — per-therapist revenue and the attribution audit both depend on it. On a shared reception PC, sign out at the end of every shift.',
    },
    {
      id: 'link-therapist',
      title: 'Link every therapist to their login',
      body: 'Settings → Team → Service roster → Linked login. An unlinked therapist sees an empty Today board and will think the app is broken.',
    },
    {
      id: 'log-visit',
      title: 'Log your first real visit',
      body: 'Use + New visit: search or create the patient, pick therapist and service, then Save. Invoices can only be issued against a real visit.',
    },
    {
      id: 'wait-synced',
      title: 'Wait for Synced before invoicing',
      body: canInvoice
        ? 'Visits save offline; invoice numbers do not. If the badge says Offline or pending, collect cash if you must, but do not issue an invoice until it reads Synced.'
        : 'Your plan doesn’t include invoicing yet — this applies once you’re on Solo or above. Visits still save and sync normally either way.',
    },
    {
      id: 'clinical-notes',
      title: 'Decide on clinical notes for your team',
      body: 'Settings → Clinic profile → Optional modules. First week should be ledger + billing only. Turn clinical notes on for one willing therapist, not the whole roster.',
    },
    {
      id: 'backup',
      title: 'Take a backup this week',
      body: 'Settings → Data & maintenance → Data backup. Export once after the first real day so you know the restore path before you need it.',
    },
  ];
}

export function useFirstWeekChecklistVisible() {
  // Dexie `get()` returns undefined for a missing key, which is the same
  // sentinel useLiveQuery uses while the query is still opening — so we
  // map "no row" onto an explicit value and only treat `undefined` as
  // "still loading" (hide the card for that one frame).
  const row = useLiveQuery(async () => {
    const existing = await db.meta.get(FIRST_WEEK_CHECKLIST_META_KEY);
    return existing ?? { key: FIRST_WEEK_CHECKLIST_META_KEY, value: '0' };
  }, []);
  return row === undefined ? undefined : row.value !== '1';
}

export async function dismissFirstWeekChecklist() {
  await db.meta.put({ key: FIRST_WEEK_CHECKLIST_META_KEY, value: '1' });
}

/** `undefined` while still loading (same convention as
 *  `useFirstWeekChecklistVisible`) so callers can hold off rendering
 *  instead of flashing an empty checklist for one frame. */
function useCompletedStepIds(): Set<string> | undefined {
  const row = useLiveQuery(() => db.meta.get(COMPLETED_STEPS_META_KEY), []);
  if (row === undefined) return undefined;
  if (!row) return new Set();
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    // corrupt value — treated as "nothing completed yet"
  }
  return new Set();
}

async function setStepCompleted(id: string, completed: boolean, current: Set<string>) {
  const next = new Set(current);
  if (completed) next.add(id);
  else next.delete(id);
  await db.meta.put({ key: COMPLETED_STEPS_META_KEY, value: JSON.stringify([...next]) });
}

export function FirstWeekSetupLink() {
  const visible = useFirstWeekChecklistVisible();
  if (!visible) return null;
  return (
    <Link
      to="/settings"
      className="text-sm text-[var(--muted)] hover:text-[var(--teal)]"
    >
      Setup: first week
    </Link>
  );
}

export function FirstWeekChecklist({ compact }: { compact?: boolean }) {
  const clinic = useClinic();
  const entitlements = useEntitlements(clinic.id);
  const completed = useCompletedStepIds();
  const steps = buildSteps(
    entitlements.enforcementEnabled && entitlements.maxMembers <= 1,
    entitlements.can('invoicing')
  );
  const allDone = completed !== undefined && steps.every((s) => completed.has(s.id));

  return (
    <section
      className="rounded-2xl border border-[var(--teal-light)] bg-[var(--surface)] p-5 shadow-sm"
      aria-labelledby="first-week-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="first-week-heading" className="font-display text-base font-semibold text-[var(--ink)]">
            First week
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            For the admin setting up this clinic, not daily work for front desk. Workspace is where
            you’ll live day to day once this is done — today’s visits, money still to collect, and
            stale packages, before you ever need to open the Ledger.
          </p>
        </div>
        <button
          type="button"
          className={`${btnSecondary} shrink-0 px-3 py-1.5 text-xs`}
          onClick={() => void dismissFirstWeekChecklist()}
        >
          Hide
        </button>
      </div>

      {allDone ? (
        <p className="mt-3 flex items-center gap-2 text-sm font-medium text-[var(--moss)]">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--moss-light)] text-[11px]">
            ✓
          </span>
          Setup complete — all 8 steps done.
        </p>
      ) : (
        <ol className={`mt-3 space-y-3 ${compact ? '' : 'tab:grid tab:grid-cols-2 tab:gap-x-6 tab:space-y-0 tab:gap-y-3'}`}>
          {steps.map((step, i) => {
            const done = completed?.has(step.id) ?? false;
            return (
              <li key={step.id} className="flex gap-2.5 text-sm">
                <button
                  type="button"
                  aria-label={done ? `Mark "${step.title}" not done` : `Mark "${step.title}" done`}
                  onClick={() => void setStepCompleted(step.id, !done, completed ?? new Set())}
                  className={
                    done
                      ? 'font-num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--moss-light)] text-[11px] font-semibold text-[var(--moss)]'
                      : 'font-num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--teal-light)] text-[11px] font-semibold text-[var(--teal)]'
                  }
                >
                  {done ? '✓' : i + 1}
                </button>
                <div>
                  <div className={done ? 'font-medium text-[var(--muted)] line-through' : 'font-medium text-[var(--ink)]'}>
                    {step.title}
                  </div>
                  <p className="mt-0.5 text-xs leading-snug text-[var(--muted)]">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
