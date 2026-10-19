import { useState, type ReactNode } from 'react';
import { KebabMenu, Panel, menuItem } from '@/components/ui';

export type ScheduleMenuGroup = 'view' | 'actions' | 'manage';
export type ScheduleMenuIcon = 'find' | 'cancelled' | 'bell' | 'waitlist' | 'closed' | 'shift' | 'hours' | 'keys';

export type ScheduleMenuItem = {
  id: string;
  label: string;
  /** One quiet line under the label (phone sheet only). */
  hint?: string;
  icon: ScheduleMenuIcon;
  group: ScheduleMenuGroup;
  onSelect: () => void;
  /** Hide on touch phones, e.g. keyboard shortcuts (desktop popover only). */
  desktopOnly?: boolean;
};

const GROUP_TITLE: Record<ScheduleMenuGroup, string> = { view: 'View', actions: 'Do', manage: 'Manage' };
const GROUP_ORDER: ScheduleMenuGroup[] = ['view', 'actions', 'manage'];

const PATHS: Record<ScheduleMenuIcon, ReactNode> = {
  find: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></>,
  cancelled: <><circle cx="12" cy="12" r="8" /><path d="m8.5 8.5 7 7" /></>,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  waitlist: <path d="M7 4h10M7 20h10M8 4v3a4 4 0 0 0 8 0V4M8 20v-3a4 4 0 0 1 8 0v3" />,
  closed: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M9.5 13.5l5 5M14.5 13.5l-5 5" /></>,
  shift: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M17 8v5h4" /></>,
  hours: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5h4" /></>,
  keys: <><rect x="3" y="7" width="18" height="11" rx="2" /><path d="M7 11h.01M11 11h.01M15 11h.01M8 15h8" /></>,
};

function MenuIcon({ name }: { name: ScheduleMenuIcon }) {
  return (
    <svg aria-hidden className="h-5 w-5 shrink-0 text-[var(--muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}

function grouped(items: ScheduleMenuItem[]) {
  return GROUP_ORDER.map((group) => ({ group, items: items.filter((item) => item.group === group) })).filter((g) => g.items.length > 0);
}

/**
 * The schedule's ⋮ menu. Phones get a bottom sheet (grouped rows, 52px tall,
 * icon + label + one-line hint) like the therapist chip; tablet and desktop
 * keep a compact popover with the same groups separated by dividers.
 */
export function ScheduleMenu({ items, isPhone }: { items: ScheduleMenuItem[]; isPhone: boolean }) {
  const [open, setOpen] = useState(false);

  if (isPhone) {
    const visible = items.filter((item) => !item.desktopOnly);
    return (
      <div className="shrink-0">
        <button
          type="button"
          aria-label="More schedule options"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--muted)] active:bg-[var(--paper)]"
        >
          <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="12" cy="19" r="1.7" />
          </svg>
        </button>
        <Panel open={open} onClose={() => setOpen(false)} title="Schedule options">
          <div className="-mx-4 space-y-4">
            {grouped(visible).map(({ group, items: groupItems }) => (
              <section key={group} aria-label={GROUP_TITLE[group]}>
                <h3 className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{GROUP_TITLE[group]}</h3>
                <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                  {groupItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="flex min-h-[3.25rem] w-full items-center gap-3 px-4 text-left active:bg-[var(--paper)]"
                        onClick={() => {
                          setOpen(false);
                          item.onSelect();
                        }}
                      >
                        <MenuIcon name={item.icon} />
                        <span className="min-w-0">
                          <span className="block text-sm text-[var(--ink)]">{item.label}</span>
                          {item.hint && <span className="block text-xs text-[var(--muted)]">{item.hint}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <KebabMenu ariaLabel="More schedule options">
      {(close) => (
        <>
          {grouped(items).map(({ group, items: groupItems }, index) => (
            <div key={group} className={index > 0 ? 'mt-1 border-t border-[var(--border)] pt-1' : ''}>
              {groupItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${menuItem} flex items-center gap-2 !py-2 ${item.desktopOnly ? 'hidden pointer-fine:flex' : ''}`}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                >
                  <MenuIcon name={item.icon} />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </>
      )}
    </KebabMenu>
  );
}
