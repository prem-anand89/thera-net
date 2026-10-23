import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { PendingShiftRequestsStrip } from './PendingShiftRequestsStrip';
import { ShiftCoverageGrid } from './ShiftCoverageGrid';

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
    <div className="space-y-4" data-testid="shift-assignments-section">
      {/* 1. Pending Shift Requests Strip (Admin only; shows when pending requests exist) */}
      {isAdmin && (
        <PendingShiftRequestsStrip
          requests={pendingRequests}
          therapists={activeTherapists}
          templates={templates}
        />
      )}

      {/* 2. Weekly Coverage Grid & Direct Assignment */}
      <ShiftCoverageGrid
        therapists={activeTherapists}
        templates={templates}
        approvedAssignments={approvedAssignments}
        pendingAssignments={pendingRequests}
        clinic={clinic}
      />
    </div>
  );
}
