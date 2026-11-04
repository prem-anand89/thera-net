import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { PendingShiftRequestsStrip } from './PendingShiftRequestsStrip';
import { ShiftCoverageGrid } from './ShiftCoverageGrid';
import { SoloWorkingHours } from './SoloWorkingHours';

export function ShiftAssignmentsSection() {
  const clinic = useClinic();
  const { isAdmin } = usePermissions();
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinic.id, true), [clinic.id]);
  const assignments = useLiveQuery(
    () => repos.therapistShiftAssignments.listByClinic(clinic.id),
    [clinic.id]
  );

  const activeTherapists = useMemo(
    () => (therapists ?? []).filter((t) => t.active !== false),
    [therapists]
  );

  const pendingRequests = useMemo(
    () => (assignments ?? []).filter((a) => a.status === 'pending'),
    [assignments]
  );

  const approvedAssignments = useMemo(
    () => (assignments ?? []).filter((a) => a.status === 'approved'),
    [assignments]
  );

  if (!therapists || !templates || !assignments) return null;

  return (
    <div id="settings-card-team-shifts" className="scroll-mt-4 space-y-4" data-testid="shift-assignments-section">
      {/* 1. Pending Shift Requests Strip (Admin only; shows when pending requests exist) */}
      {isAdmin && (
        <PendingShiftRequestsStrip
          requests={pendingRequests}
          therapists={activeTherapists}
          templates={templates}
        />
      )}

      {/* 2. One therapist: just their week. Otherwise the Weekly shifts card. */}
      {activeTherapists.length === 1 ? (
        <SoloWorkingHours
          therapist={activeTherapists[0]}
          templates={templates}
          approvedAssignments={approvedAssignments}
          clinic={clinic}
        />
      ) : (
        <ShiftCoverageGrid
          therapists={activeTherapists}
          templates={templates}
          approvedAssignments={approvedAssignments}
          clinic={clinic}
        />
      )}
    </div>
  );
}
