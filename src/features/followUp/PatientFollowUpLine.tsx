import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { followUpState, type FollowUpState } from '@/domain/followUp';
import { formatDateDMY } from '@/domain/fiscalYear';
import { toLocalDateStr } from '@/domain/schedule';
import type { Patient } from '@/domain/types';
import { repos } from '@/services';
import { FollowUpDialog } from './FollowUpDialog';

/** How the follow-up reads on the profile ("due in 2 days", "missed"). Pure, so the wording is tested. */
export function followUpLabel(state: FollowUpState, daysFromDue: number, dueOn: string): string {
  const day = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  switch (state) {
    case 'planned':
      return `planned for ${formatDateDMY(dueOn)}`;
    case 'due_soon':
      return `due in ${day(daysFromDue)} (${formatDateDMY(dueOn)})`;
    case 'due':
      return 'due today';
    case 'overdue':
      return `overdue by ${day(-daysFromDue)}`;
    case 'missed':
    case 'expired':
      return `missed (was due ${formatDateDMY(dueOn)})`;
    case 'done':
      return `done (was due ${formatDateDMY(dueOn)})`;
    default:
      return '';
  }
}

/** One line on the patient profile: the follow-up and its state, with Set / Change. */
export function PatientFollowUpLine({ patient }: { patient: Patient }) {
  const clinic = useClinic();
  const [open, setOpen] = useState(false);
  const visits = useLiveQuery(() => repos.visits.list({ clinicId: clinic.id, patientId: patient.id }), [clinic.id, patient.id]);
  const appointments = useLiveQuery(() => repos.appointments.listByClinic(clinic.id), [clinic.id]);
  const today = toLocalDateStr(new Date());
  const { state, daysFromDue } = followUpState(patient, visits ?? [], appointments ?? [], today);
  const tone =
    state === 'due' || state === 'overdue' ? 'text-[var(--rust)]' : state === 'missed' || state === 'expired' ? 'text-[var(--amber)]' : 'text-[var(--ink)]';

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm" data-testid="patient-follow-up">
      <span className="text-[var(--muted)]/70">Follow-up</span>
      {patient.followUpOn ? (
        <>
          <span className={tone}>{followUpLabel(state, daysFromDue, patient.followUpOn)}</span>
          {patient.followUpNote && <span className="text-[var(--muted)]">· {patient.followUpNote}</span>}
        </>
      ) : (
        <span className="text-[var(--muted)]">none</span>
      )}
      <button type="button" className="text-xs font-medium text-[var(--teal)] hover:underline" onClick={() => setOpen(true)}>
        {patient.followUpOn ? 'Change' : 'Set'}
      </button>
      <FollowUpDialog open={open} patientId={patient.id} onClose={() => setOpen(false)} />
    </div>
  );
}
