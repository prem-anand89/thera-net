// HEP (home exercise programs): the clinic's exercises, templates and the patients' programs. Clinical staff only:
// front desk is sent back to Workspace. The URL keeps the tab (?tab=library|templates|programs).
import { Navigate, useNavigate, useSearch } from '@tanstack/react-router';
import { usePermissions } from '@/app/usePermissions';
import { LoadingRows, segOption, segTrack } from '@/components/ui';
import { HEP_TABS, type HepSearch, type HepTab } from './hepSearch';
import { useState } from 'react';
import type { ExerciseTemplate } from '@/domain/hep';
import type { ProgramBundle } from '@/services/hepService';
import { LibraryTab } from './LibraryTab';
import { MessagePatientSheet } from './MessagePatientSheet';
import { ProgramSheet } from './ProgramSheet';
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
  const [sheet, setSheet] = useState<{ template?: ExerciseTemplate; program?: ProgramBundle; patientId?: string } | null>(null);
  const [messaging, setMessaging] = useState<{ patientId: string; token: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
      {tab === 'templates' && <TemplatesTab reloadKey={reloadKey} onUse={(template) => setSheet({ template })} />}
      {tab === 'programs' && (
        <ProgramsTab
          reloadKey={reloadKey}
          onPrescribeNext={(row, bundle) => setSheet({ patientId: row.patientId, program: bundle })}
          onMessage={(row, bundle) => { if (bundle.access && !bundle.access.linkRevoked) setMessaging({ patientId: row.patientId, token: bundle.access.token }); }}
        />
      )}
      <StarterSetSheet open={starterOpen} onClose={() => setStarterOpen(false)} />
      <ProgramSheet open={sheet !== null} mode="new" patientId={sheet?.patientId} startFrom={sheet ? { template: sheet.template, program: sheet.program } : undefined} onClose={() => setSheet(null)} onSaved={() => setReloadKey((k) => k + 1)} />
      {messaging && <MessagePatientSheet open patientId={messaging.patientId} token={messaging.token} onClose={() => setMessaging(null)} />}
    </div>
  );
}
