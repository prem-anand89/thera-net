import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { btnSecondary } from '@/components/ui';

export const FIRST_WEEK_CHECKLIST_META_KEY = 'firstWeekChecklistDismissed';

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Workspace is home',
    body: 'Start every day here. Today’s visits, money still to collect, and stale packages show up before you open the Ledger.',
  },
  {
    title: 'Log a visit before you bill',
    body: 'Use + New visit: search or create the patient, pick therapist and service, then Save. Invoices can only be issued against a real visit.',
  },
  {
    title: 'Wait for Synced before invoicing',
    body: 'Visits save offline; invoice numbers do not. If the badge says Offline or pending, collect cash if you must, but do not issue an invoice until it reads Synced.',
  },
  {
    title: 'Link every therapist login',
    body: 'Settings → Team → Service roster → Linked login. An unlinked therapist sees an empty Today board and will think the app is broken.',
  },
  {
    title: 'Keep Core Assessment off until asked',
    body: 'Settings → Features. First week should be ledger + billing only. Turn clinical notes on for one willing therapist, not the whole roster.',
  },
  {
    title: 'Sign out on shared PCs',
    body: 'Reception browsers keep a local copy until Sign out. Always sign out at the end of a shift so the next person does not see another user’s clinic data.',
  },
  {
    title: 'Take a backup this week',
    body: 'Settings → Data & maintenance → Data backup. Export once after the first real day so you know the restore path before you need it.',
  },
];

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
            For the admin setting up this clinic — not daily work for front desk.
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
      <ol className={`mt-3 space-y-3 ${compact ? '' : 'tab:grid tab:grid-cols-2 tab:gap-x-6 tab:space-y-0 tab:gap-y-3'}`}>
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-2.5 text-sm">
            <span className="font-num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--teal-light)] text-[11px] font-semibold text-[var(--teal)]">
              {i + 1}
            </span>
            <div>
              <div className="font-medium text-[var(--ink)]">{step.title}</div>
              <p className="mt-0.5 text-xs leading-snug text-[var(--muted)]">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
