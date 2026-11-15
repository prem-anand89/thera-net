// The signed-in patient page's bottom bar: Home and Exercises. 56px tall, large touch targets, the active tab marked
// by a teal top border. The therapist's program preview shows the same bar inside its phone frame (`framed`).
import type { ReactNode } from 'react';

export type HepTab = 'home' | 'exercises';

const HomeIcon = () => (
  <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20h5v-6h4v6h5V9.5" />
  </svg>
);

const ExerciseIcon = () => (
  <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" />
  </svg>
);

export function HepTabBar({ tab, onTab, framed = false }: { tab: HepTab; onTab: (tab: HepTab) => void; framed?: boolean }) {
  const tabs: Array<{ id: HepTab; label: string; icon: ReactNode }> = [
    { id: 'home', label: 'Home', icon: <HomeIcon /> },
    { id: 'exercises', label: 'Exercises', icon: <ExerciseIcon /> },
  ];
  return (
    <nav
      aria-label="Pages"
      className={`${framed ? 'absolute' : 'fixed'} inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white ${framed ? '' : 'pb-[env(safe-area-inset-bottom)]'}`}
    >
      <div role="tablist" className="mx-auto flex max-w-xl">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTab(t.id)}
              className={`flex h-14 flex-1 flex-col items-center justify-center gap-0.5 border-t-4 text-sm font-semibold ${active ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-500'}`}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
