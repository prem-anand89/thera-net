// HEP (home exercise programs): the clinic's exercises, templates and the patients' programs. Clinical staff only:
// front desk is sent back to Workspace. The URL keeps the tab (?tab=library|templates|programs).
import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearch } from '@tanstack/react-router';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { ChipCount, LoadingRows } from '@/components/ui';
import { addDaysISO, type ExerciseTemplate } from '@/domain/hep';
import type { ProgramBundle } from '@/services/hepService';
import { HEP_TABS, type HepSearch, type HepTab } from './hepSearch';
import { LibraryTab } from './LibraryTab';
import { MessagePatientSheet } from './MessagePatientSheet';
import { ProgramSheet } from './ProgramSheet';
import { countAttentionPrograms } from './programRows';
import { StarterSetSheet } from './StarterSetSheet';
import { ProgramsTab } from './ProgramsTab';
import { TemplatesTab } from './TemplatesTab';
import { clinicToday, useClinicPrograms, useExercises, useOnline } from './useHepData';

const LABELS: Record<HepTab, string> = { library: 'My exercises', templates: 'Templates', programs: 'Programs' };
const WINDOW_DAYS = 14;

export function HepPage() {
  const clinic = useClinic();
  const online = useOnline();
  const { canUseExercises, role } = usePermissions();
  const search = useSearch({ strict: false }) as HepSearch;
  const navigate = useNavigate();
  const exercises = useExercises(clinic.id);
  const tab: HepTab = search.tab ?? (exercises && exercises.length > 0 ? 'programs' : 'library');
  const [starterOpen, setStarterOpen] = useState(false);
  const [sheet, setSheet] = useState<{ template?: ExerciseTemplate; program?: ProgramBundle; patientId?: string } | null>(null);
  const [messaging, setMessaging] = useState<{ patientId: string; token: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const programs = useClinicPrograms(clinic, { enabled: canUseExercises, reloadKey });

  const today = clinicToday(clinic);
  const windowStart = addDaysISO(today, -WINDOW_DAYS);
  const attentionCount = useMemo(
    () =>
      !canUseExercises || !online || programs.bundles === null || programs.error !== null
        ? null
        : countAttentionPrograms(programs.bundles, { today, windowStart }),
    [canUseExercises, online, programs.bundles, programs.error, today, windowStart],
  );

  if (role === 'unknown') return <LoadingRows rows={3} label="Loading" />;
  if (!canUseExercises) return <Navigate to="/workspace" replace />;
  if (!search.tab && exercises === undefined) return <LoadingRows rows={3} label="Loading" />;

  return (
    <div className="space-y-5">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)] sm:sr-only">HEP</h1>
      <div className="hide-scrollbar flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--surface)] p-0.5 sm:gap-1 sm:p-1" role="tablist" aria-label="HEP sections">
        {HEP_TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors sm:px-4 sm:py-1.5 sm:text-sm ${tab === t ? 'bg-[var(--teal)] text-white shadow-sm' : 'text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]'}`} onClick={() => void navigate({ to: '/hep', search: { tab: t } })}>
            {LABELS[t]}
            {t === 'programs' && attentionCount != null && attentionCount > 0 && <ChipCount n={attentionCount} />}
          </button>
        ))}
      </div>
      {tab === 'library' && <LibraryTab onStarter={() => setStarterOpen(true)} />}
      {tab === 'templates' && <TemplatesTab reloadKey={reloadKey} onUse={(template) => setSheet({ template })} />}
      {tab === 'programs' && (
        <ProgramsTab
          reloadKey={reloadKey}
          programs={programs.bundles}
          programsError={programs.error}
          onReload={programs.reload}
          onNewProgram={() => setSheet({})}
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
