import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { IconHep, IconPatients, IconReports, IconSettings } from '@/components/NavIcons';
import { IconChevronRight } from '@/components/StatIcons';
import { useHepPainDot } from '@/features/hep/hepSignals';

/**
 * Phone-only hub for the pages the bottom bar has no room for (Workspace,
 * Schedule, New visit and Ledger take the bar). Booking requests aren't
 * listed: the Schedule tab already carries their badge and inbox.
 */
export function MorePage() {
  const clinic = useClinic();
  const { canEditSettings, canUseExercises, isAdmin, role } = usePermissions();
  // Same gate as the desktop nav's Reports item in Shell.tsx.
  const showReports = isAdmin || role === 'front_desk';
  const hepPainDot = useHepPainDot(clinic.id, canUseExercises);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)]">More</h1>
      <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <MoreItem to="/patients" label="Patients" icon={<IconPatients />} />
        {showReports && <MoreItem to="/insights" label="Reports" icon={<IconReports />} />}
        {canUseExercises && <MoreItem to="/hep" label="HEP" icon={<IconHep />} dot={hepPainDot} />}
        {canEditSettings && <MoreItem to="/settings" label="Settings" icon={<IconSettings />} />}
      </ul>
    </div>
  );
}

function MoreItem({ to, label, icon, dot = false }: { to: '/insights' | '/settings' | '/patients' | '/hep'; label: string; icon: ReactNode; dot?: boolean }) {
  return (
    <li>
      <Link
        to={to}
        className="flex min-h-12 items-center gap-3 px-4 py-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
      >
        <span className="text-[var(--teal)]" aria-hidden>
          {icon}
        </span>
        <span className="flex-1">{label}</span>
        {dot && (
          <>
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[var(--rust)]" />
            <span className="sr-only">, pain report waiting</span>
          </>
        )}
        <IconChevronRight className="h-4 w-4 text-[var(--muted)]" />
      </Link>
    </li>
  );
}
