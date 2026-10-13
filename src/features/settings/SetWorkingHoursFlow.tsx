import { useCallback, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { repos, bookingService } from '@/services';
import { ConfirmDialog } from '@/components/ui';
import { WorkingHoursSheet } from '@/components/schedule/WorkingHoursSheet';
import { appointmentsOutsideHours } from '@/features/schedule/hoursConflicts';
import { toLocalDateStr } from '@/domain/schedule';
import type { WorkingHours } from '@/domain/types';

export type SetWorkingHoursFlowProps = {
  therapist: {
    id: string;
    name: string;
    workingHours?: WorkingHours | null;
  };
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

export function SetWorkingHoursFlow({
  therapist,
  open,
  onClose,
  onSaved,
}: SetWorkingHoursFlowProps) {
  const clinic = useClinic();
  const allAppointments = useLiveQuery(
    () => repos.appointments.listByClinic(clinic.id),
    [clinic.id]
  );

  const [pendingConfirm, setPendingConfirm] = useState<{
    value: WorkingHours | null;
    count: number;
    resolve: () => void;
    reject: (error: unknown) => void;
  } | null>(null);

  const clinicHours = {
    startHour: clinic.bookingStartHour ?? 9,
    endHour: clinic.bookingEndHour ?? 17,
  };
  const slotMinutes = clinic.slotDurationMinutes || 30;

  const handleSave = useCallback(
    (value: WorkingHours | null) =>
      new Promise<void>((resolve, reject) => {
        const todayIso = toLocalDateStr(new Date());
        const conflicts = appointmentsOutsideHours({
          appointments: allAppointments ?? [],
          therapistId: therapist.id,
          hours: value,
          clinicHours,
          slotMinutes,
          todayIso,
        });

        if (conflicts.length === 0) {
          bookingService
            .assignCustomHours(therapist.id, value)
            .then(() => {
              resolve();
              onSaved?.();
            }, reject);
          return;
        }

        setPendingConfirm({ value, count: conflicts.length, resolve, reject });
      }),
    [allAppointments, clinicHours, slotMinutes, therapist.id, onSaved]
  );

  return (
    <>
      <WorkingHoursSheet
        open={open}
        therapistName={therapist.name}
        value={therapist.workingHours}
        clinic={{
          startHour: clinicHours.startHour,
          endHour: clinicHours.endHour,
          closedWeekdays: clinic.closedWeekdays,
        }}
        onSave={handleSave}
        onClose={onClose}
      />

      <ConfirmDialog
        open={pendingConfirm !== null}
        title="Save these hours anyway?"
        message={
          pendingConfirm
            ? `${pendingConfirm.count} upcoming appointment${pendingConfirm.count === 1 ? '' : 's'} fall outside these new hours. Save anyway?`
            : ''
        }
        confirmLabel="Save anyway"
        onCancel={() => {
          const pending = pendingConfirm;
          setPendingConfirm(null);
          pending?.reject(new Error('Not saved — adjust the hours or save again to confirm.'));
        }}
        onConfirm={() => {
          const pending = pendingConfirm;
          setPendingConfirm(null);
          if (pending) {
            void bookingService
              .assignCustomHours(therapist.id, pending.value)
              .then(() => {
                pending.resolve();
                onSaved?.();
              }, pending.reject);
          }
        }}
      />
    </>
  );
}
