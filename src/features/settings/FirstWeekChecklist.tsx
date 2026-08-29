import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useEntitlements } from '@/app/useEntitlements';
import { btnSecondary } from '@/components/ui';

export const FIRST_WEEK_CHECKLIST_META_KEY = 'firstWeekChecklistDismissed';
const COMPLETED_STEPS_META_KEY = 'firstWeekChecklistCompletedSteps';
/** Written by `SettingsPage.tsx`'s `DataBackup` on a successful export —
 *  the one signal the "Take a backup" step needs to auto-detect itself,
 *  the same way clinic-profile/services/team/log-a-visit already can. */
export const LAST_BACKUP_META_KEY = 'lastBackupExportedAt';

/** Facts about this clinic a live query can actually confirm — everything
 *  a step needs to detect its own completion instead of asking an admin to
 *  remember to tick it. `undefined` while any underlying query is still
 *  resolving; see `useFirstWeekSignals`. */
export interface FirstWeekSignals {
  clinicProfileSet: boolean;
  servicesPriced: boolean;
  teamInvited: boolean;
  therapistsLinked: boolean;
  visitLogged: boolean;
  backedUp: boolean;
}

/** The only two places a step's "Continue" link can go — kept as a small
 *  closed union (rather than a generic `{ to, search }` shape) so each
 *  variant's `search` stays typed against that route's own schema instead
 *  of widened to `Record<string, string>`. */
type StepLink =
  { kind: 'settings'; tab: 'profile' | 'team' | 'services' | 'data' } | { kind: 'new-visit' };

/**
 * Real setup sequence, an admin's actual order of operations — not the
 * previous version's flat list of gotcha/safety tips with no ordering
 * logic. `id`s are stable strings (not array indices), so reordering this
 * list later can't silently corrupt someone's mid-flight completion state
 * in `COMPLETED_STEPS_META_KEY`. Two steps (`invite-team`, `wait-synced`)
 * get plan-aware copy — see `buildSteps` below.
 *
 * `auto`, when present, derives the step's done state from `FirstWeekSignals`
 * instead of a self-reported checkbox — clinic-profile/services/team/
 * therapist-link/log-a-visit/backup are all facts a live query can confirm,
 * so guessing whether the admin remembered to tick them is unnecessary.
 * Two steps stay genuinely manual: "wait for Synced" is a behavioral
 * reminder, not a completable fact, and "decide on clinical notes" is a
 * decision where On and Off are both valid — a boolean toggle's value can't
 * tell "decided" apart from "never looked at it".
 */
interface Step {
  id: string;
  title: string;
  body: string;
  link?: StepLink;
  linkLabel?: string;
  auto?: (signals: FirstWeekSignals) => boolean;
}

function buildSteps(seatLimited: boolean, canInvoice: boolean): Step[] {
  return [
    {
      id: 'clinic-profile',
      title: 'Set up your clinic profile',
      body: 'Name, address, invoice prefix, tax %, revenue split. Everything else — every invoice, every split calculation — reads from this.',
      link: { kind: 'settings', tab: 'profile' },
      linkLabel: 'Go to Clinic profile',
      auto: (s) => s.clinicProfileSet,
    },
    {
      id: 'price-services',
      title: 'Price your services',
      body: 'Set the catalog before logging visits; a visit billed against an unpriced service can’t invoice cleanly later.',
      link: { kind: 'settings', tab: 'services' },
      linkLabel: 'Go to Services',
      auto: (s) => s.servicesPriced,
    },
    {
      id: 'invite-team',
      title: 'Invite your team',
      body: seatLimited
        ? 'Your plan allows 1 login for now — invite a teammate once you upgrade. If it’s a shared reception PC, still sign out at the end of every shift so the next person doesn’t see this login’s data.'
        : 'Each person needs their own login, not shared credentials — per-therapist revenue and the attribution audit both depend on it. On a shared reception PC, sign out at the end of every shift.',
      link: { kind: 'settings', tab: 'team' },
      linkLabel: 'Go to Team',
      auto: (s) => s.teamInvited,
    },
    {
      id: 'link-therapist',
      title: 'Link every therapist to their login',
      body: 'Team → Service roster → Linked login. An unlinked therapist sees an empty Today board and will think the app is broken.',
      link: { kind: 'settings', tab: 'team' },
      linkLabel: 'Go to Team',
      auto: (s) => s.therapistsLinked,
    },
    {
      id: 'log-visit',
      title: 'Log your first real visit',
      body: 'Search or create the patient, pick therapist and service, then Save. Invoices can only be issued against a real visit.',
      link: { kind: 'new-visit' },
      linkLabel: '+ New visit',
      auto: (s) => s.visitLogged,
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
      body: 'Clinic profile → Optional modules. First week should be ledger + billing only. Turn clinical notes on for one willing therapist, not the whole roster.',
      link: { kind: 'settings', tab: 'profile' },
      linkLabel: 'Go to Clinic profile',
    },
    {
      id: 'backup',
      title: 'Take a backup this week',
      body: 'Data & maintenance → Data backup. Export once after the first real day so you know the restore path before you need it.',
      link: { kind: 'settings', tab: 'data' },
      linkLabel: 'Go to Data & maintenance',
      auto: (s) => s.backedUp,
    },
  ];
}

function StepLinkAnchor({ link, label }: { link: StepLink; label: string }) {
  const className = 'mt-1 inline-block text-xs font-medium text-[var(--teal)] hover:underline';
  if (link.kind === 'new-visit') {
    return (
      <Link to="/visits/new" className={className}>
        {label} →
      </Link>
    );
  }
  return (
    <Link to="/settings" search={{ tab: link.tab }} className={className}>
      {label} →
    </Link>
  );
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
 *  instead of flashing an empty checklist for one frame. Only read for the
 *  two genuinely manual steps now — every auto step ignores this. */
function useCompletedStepIds(): Set<string> | undefined {
  const row = useLiveQuery(() => db.meta.get(COMPLETED_STEPS_META_KEY), []);
  if (row === undefined) return undefined;
  if (!row) return new Set();
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (Array.isArray(parsed))
      return new Set(parsed.filter((x): x is string => typeof x === 'string'));
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

/**
 * The facts behind every auto-derived step, in one place so both the full
 * card and the compact account-menu summary read exactly the same signals.
 * Parameterized by `clinicId` rather than reading `useClinic()` — this gets
 * called from the account menu, which can't assume the calling component
 * sits under `ClinicContext`.
 */
function useFirstWeekSignals(clinicId: string): FirstWeekSignals | undefined {
  const clinic = useLiveQuery(() => repos.clinics.get(clinicId), [clinicId]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinicId, true), [clinicId]);
  const catalog = useLiveQuery(() => repos.catalog.list(clinicId), [clinicId]);
  const entitlements = useEntitlements(clinicId);
  const hasVisits = useLiveQuery(
    () => repos.visits.list({ clinicId }).then((v) => v.length > 0),
    [clinicId]
  );
  // Same "no row" vs "still loading" disambiguation as
  // useFirstWeekChecklistVisible above.
  const lastBackupRow = useLiveQuery(async () => {
    const existing = await db.meta.get(LAST_BACKUP_META_KEY);
    return existing ?? { key: LAST_BACKUP_META_KEY, value: '' };
  }, []);

  if (
    clinic === undefined ||
    therapists === undefined ||
    catalog === undefined ||
    entitlements.loading ||
    hasVisits === undefined ||
    lastBackupRow === undefined
  ) {
    return undefined;
  }

  const unlinkedCount = therapists.filter((t) => !t.userId).length;

  return {
    clinicProfileSet: Boolean(clinic.address?.trim()),
    servicesPriced: catalog.length > 0,
    // clinic_members gets a row the moment an invite is issued (Settings'
    // Team tab), not only once the invitee accepts — seatsUsed > 1 means
    // someone besides the creating admin is on the roster, invited or not
    // yet logged in either way.
    teamInvited: (entitlements.seatsUsed ?? 0) > 1,
    therapistsLinked: therapists.length > 0 && unlinkedCount === 0,
    visitLogged: hasVisits,
    backedUp: lastBackupRow.value !== '',
  };
}

function stepDone(
  step: Step,
  signals: FirstWeekSignals | undefined,
  completed: Set<string> | undefined
): boolean {
  if (step.auto) return signals ? step.auto(signals) : false;
  return completed?.has(step.id) ?? false;
}

/**
 * Compact summary of the same state `SettingsPage`'s `showFirstWeek`/
 * `FirstWeekChecklist` already track — for a place that wants a one-line
 * "N of M, continue here" nudge (the account menu) rather than the full
 * card. `nextStep` is the first not-done step in order, so the account
 * menu can link straight to wherever setup was left off instead of always
 * dropping back on Settings' default tab.
 */
export function useFirstWeekChecklistSummary(clinicId: string):
  | {
      visible: boolean;
      completedCount: number;
      totalCount: number;
      nextStep: { title: string; link?: StepLink; linkLabel?: string } | null;
    }
  | undefined {
  const signals = useFirstWeekSignals(clinicId);
  const entitlements = useEntitlements(clinicId);
  const notDismissed = useFirstWeekChecklistVisible();
  const completed = useCompletedStepIds();

  if (
    signals === undefined ||
    notDismissed === undefined ||
    completed === undefined ||
    entitlements.loading
  ) {
    return undefined;
  }

  const steps = buildSteps(
    entitlements.enforcementEnabled && entitlements.maxMembers <= 1,
    entitlements.can('invoicing')
  );
  const doneFlags = steps.map((s) => stepDone(s, signals, completed));
  const completedCount = doneFlags.filter(Boolean).length;
  const nextIndex = doneFlags.findIndex((d) => !d);
  const nextStep =
    nextIndex === -1
      ? null
      : {
          title: steps[nextIndex].title,
          link: steps[nextIndex].link,
          linkLabel: steps[nextIndex].linkLabel,
        };

  // Same gate SettingsPage's own showFirstWeek uses (unlinked therapist or
  // an empty catalog) — kept here rather than re-derived from `signals`,
  // since "visible at all" and "individually done" are different questions
  // (a clinic can clear both real-data gates while still having, say, the
  // backup step outstanding, and the card should stay up for that).
  const gatesIncomplete = !signals.therapistsLinked || !signals.servicesPriced;

  return {
    visible: notDismissed && gatesIncomplete,
    completedCount,
    totalCount: steps.length,
    nextStep,
  };
}

export function FirstWeekSetupLink() {
  const visible = useFirstWeekChecklistVisible();
  if (!visible) return null;
  return (
    <Link to="/settings" className="text-sm text-[var(--muted)] hover:text-[var(--teal)]">
      Setup: first week
    </Link>
  );
}

export function FirstWeekChecklist({ compact }: { compact?: boolean }) {
  const clinic = useClinic();
  const entitlements = useEntitlements(clinic.id);
  const signals = useFirstWeekSignals(clinic.id);
  const completed = useCompletedStepIds();
  const steps = buildSteps(
    entitlements.enforcementEnabled && entitlements.maxMembers <= 1,
    entitlements.can('invoicing')
  );
  const allDone =
    signals !== undefined &&
    completed !== undefined &&
    steps.every((s) => stepDone(s, signals, completed));

  return (
    <section
      className="rounded-2xl border border-[var(--teal-light)] bg-[var(--surface)] p-5 shadow-sm"
      aria-labelledby="first-week-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="first-week-heading"
            className="font-display text-base font-semibold text-[var(--ink)]"
          >
            First week
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            For the admin setting up this clinic, not daily work for front desk. Most steps below
            check themselves off as you go — Workspace is where you’ll live day to day once this is
            done, before you ever need to open the Ledger.
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
        <ol
          className={`mt-3 space-y-3 ${compact ? '' : 'tab:grid tab:grid-cols-2 tab:gap-x-6 tab:space-y-0 tab:gap-y-3'}`}
        >
          {steps.map((step, i) => {
            const done = stepDone(step, signals, completed);
            const isAuto = Boolean(step.auto);
            const badgeClass = done
              ? 'font-num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--moss-light)] text-[11px] font-semibold text-[var(--moss)]'
              : 'font-num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--teal-light)] text-[11px] font-semibold text-[var(--teal)]';
            return (
              <li key={step.id} className="flex gap-2.5 text-sm">
                {isAuto ? (
                  <span
                    aria-label={
                      done ? `"${step.title}" detected as done` : `"${step.title}" not done yet`
                    }
                    className={badgeClass}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={
                      done ? `Mark "${step.title}" not done` : `Mark "${step.title}" done`
                    }
                    onClick={() => void setStepCompleted(step.id, !done, completed ?? new Set())}
                    className={badgeClass}
                  >
                    {done ? '✓' : i + 1}
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <div
                    className={
                      done
                        ? 'font-medium text-[var(--muted)] line-through'
                        : 'font-medium text-[var(--ink)]'
                    }
                  >
                    {step.title}
                  </div>
                  <p className="mt-0.5 text-xs leading-snug text-[var(--muted)]">{step.body}</p>
                  {step.link && step.linkLabel && !done && (
                    <StepLinkAnchor link={step.link} label={step.linkLabel} />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
