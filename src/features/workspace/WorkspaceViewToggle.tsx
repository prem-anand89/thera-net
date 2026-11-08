import { segTrack, segOption } from '@/components/ui';
import type { ReactNode } from 'react';
import type { WorkspaceViewChoice } from './workspaceView';

/**
 * "Showing: All | Mine", placed under the Collected / Dues tiles. It governs the sections below it (appointments,
 * today's visits, follow-ups, packages); the tiles above stay as they are (their card says what they cover).
 */
export function WorkspaceViewToggle({
  mineOnly,
  onChange,
  extra,
}: {
  mineOnly: boolean;
  onChange: (next: WorkspaceViewChoice) => void;
  /** Another choice that sits beside All | Mine and governs the same sections (the place chips). */
  extra?: ReactNode;
}) {
  const options: [WorkspaceViewChoice, string][] = [
    ['all', 'All'],
    ['mine', 'Mine'],
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--muted)]">Showing</span>
      <div role="tablist" aria-label="Workspace view" className={segTrack}>
        {options.map(([key, label]) => {
          const active = (key === 'mine') === mineOnly;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(key)}
              className={segOption(active)}
            >
              {label}
            </button>
          );
        })}
        </div>
        {extra}
      </div>
    </div>
  );
}
