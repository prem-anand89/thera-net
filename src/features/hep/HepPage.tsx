// HEP (home exercise programs): the clinic's exercises, templates and the patients' programs. Clinical staff only:
// front desk is sent back to Workspace. The URL keeps the tab (?tab=library|templates|programs).
import { Navigate, useNavigate, useSearch } from '@tanstack/react-router';
import { usePermissions } from '@/app/usePermissions';
import { LoadingRows, segOption, segTrack } from '@/components/ui';
import { HEP_TABS, type HepSearch, type HepTab } from './hepSearch';
import { useState } from 'react';
import { LibraryTab } from './LibraryTab';
import { StarterSetSheet } from './StarterSetSheet';
import { ProgramsTab } from './ProgramsTab';
import { TemplatesTab } from './TemplatesTab';

const LABELS: Record<HepTab, string> = { library: 'Library', templates: 'Templates', programs: 'Programs' };

export function HepPage() {
  const { canUseExercises, role } = usePermissions();
  const search = useSearch({ strict: false }) as HepSearch;
  const navigate = useNavigate();
  const tab: HepTab = search.tab ?? 'library';
  const [starterOpen, setStarterOpen] = useState(false);

  if (role === 'unknown') return <LoadingRows rows={3} label="Loading" />;
  if (!canUseExercises) return <Navigate to="/workspace" replace />;

  return (
    <div className="space-y-5">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)] sm:sr-only">HEP</h1>
      <div className={segTrack} role="tablist" aria-label="HEP sections">
        {HEP_TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={segOption(tab === t)} onClick={() => void navigate({ to: '/hep', search: { tab: t } })}>
            {LABELS[t]}
          </button>
        ))}
      </div>
      {tab === 'library' && <LibraryTab onStarter={() => setStarterOpen(true)} />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'programs' && <ProgramsTab />}
      <StarterSetSheet open={starterOpen} onClose={() => setStarterOpen(false)} />
    </div>
  );
}
