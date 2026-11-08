import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { useEntitlements } from '@/app/useEntitlements';
import { repos, admissionService } from '@/services';
import type { Patient } from '@/domain/types';
import { clinicCareLocations } from '@/domain/careLocations';
import { dayOfStay, openAdmissionOf } from '@/domain/admissions';
import { formatDateDM } from '@/domain/fiscalYear';
import { toLocalDateStr } from '@/domain/schedule';
import { btnSecondary, Pill } from '@/components/ui';
import { usePermissions } from '@/app/usePermissions';
import { IssueInvoiceDialog, type IssueInvoiceTarget } from '@/components/IssueInvoiceDialog';
import type { Admission } from '@/domain/types';
import { toFriendlyMessage } from '@/lib/errors';
import { askConfirm, notify } from '@/lib/notify';
import { AdmissionSheet } from './AdmissionSheet';
import { DischargeSheet } from './DischargeSheet';

/**
 * On the patient profile: whether the patient is on the ward, with Admit / Edit stay / Discharge. Shown only for a clinic
 * that has Inpatient on (or a patient who has stays on record). Admitting also needs a plan with the inpatient feature;
 * a stay already open can always be edited or discharged.
 */
export function PatientAdmissionBar({ patient }: { patient: Patient }) {
  const clinic = useClinic();
  const entitlements = useEntitlements(clinic.id);
  const stays = useLiveQuery(() => repos.admissions.listByPatient(clinic.id, patient.id), [clinic.id, patient.id]);
  const [sheet, setSheet] = useState<'admit' | 'edit' | 'discharge' | null>(null);
  const { canBill } = usePermissions();
  const visits = useLiveQuery(() => repos.visits.list({ clinicId: clinic.id, patientId: patient.id }), [clinic.id, patient.id]);
  const [invoicing, setInvoicing] = useState<IssueInvoiceTarget | null>(null);

  /** The stay's sessions not yet on a bill: what a discharge bill covers. */
  const unbilledOf = (stay: Admission) => (visits ?? []).filter((v) => !v.deleted && v.admissionId === stay.id && !v.invoiceId);
  const billableTotal = (stay: Admission) => unbilledOf(stay).reduce((sum, v) => sum + v.actualBillPaise, 0);

  function startBilling(stay: Admission) {
    const rows = unbilledOf(stay);
    if (rows.length === 0 || billableTotal(stay) <= 0) {
      notify.info('There is nothing to bill on this stay yet.');
      return;
    }
    setInvoicing({
      visitId: rows[0].id,
      visitIds: rows.map((v) => v.id),
      patientId: patient.id,
      patientLabel: patient.name,
      serviceLabel: `Inpatient stay, ${rows.length} session${rows.length === 1 ? '' : 's'}`,
      isPackage: false,
      // Inpatient sessions are saved unpaid; whether the bill is settled now is chosen when it is issued.
      alreadyCollected: false,
    });
  }

  async function offerDischargeBill(stay: Admission) {
    if (!canBill || unbilledOf(stay).length === 0 || billableTotal(stay) <= 0) return;
    const now = await askConfirm({
      title: 'Discharge bill',
      message: `Generate the bill for the ${unbilledOf(stay).length} session${unbilledOf(stay).length === 1 ? '' : 's'} on this stay now?`,
      confirmLabel: 'Generate bill',
      cancelLabel: 'Bill later',
    });
    if (now) startBilling(stay);
  }

  const wardOn = clinicCareLocations(clinic).includes('ward');
  if (stays === undefined) return null;
  const open = openAdmissionOf(stays);
  const last = stays.find((s) => s.dischargedOn);
  if (!wardOn && stays.length === 0) return null;

  async function reopen(id: string) {
    try {
      await admissionService.reopen(id);
    } catch (e) {
      notify.error(toFriendlyMessage(e));
    }
  }

  const canAdmit = wardOn && entitlements.can('inpatient');
  return (
    <section aria-label="Ward stay" className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-5 py-3">
      {open ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-[12rem] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="teal">Admitted</Pill>
              <span className="text-sm font-medium text-[var(--ink)]">
                {[open.ipdNo && `IPD ${open.ipdNo}`, open.wardBed].filter(Boolean).join(' · ') || 'Ward not set'}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Day {dayOfStay(open.admittedOn, toLocalDateStr(new Date()))} · since {formatDateDM(open.admittedOn)}
              {open.admittingDoctor ? ` · ${open.admittingDoctor}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canBill && unbilledOf(open).length > 0 && (
              <button type="button" className={btnSecondary} onClick={() => startBilling(open)}>
                Bill this stay
              </button>
            )}
            <button type="button" className={btnSecondary} onClick={() => setSheet('edit')}>
              Edit stay
            </button>
            <button type="button" className={btnSecondary} onClick={() => setSheet('discharge')}>
              Discharge
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="min-w-[12rem] flex-1 text-sm text-[var(--muted)]">
            {last ? `Last stay ${formatDateDM(last.admittedOn)} to ${formatDateDM(last.dischargedOn!)}` : 'Not admitted'}
            {last && (
              <button type="button" className="ml-2 text-xs text-[var(--teal)] hover:underline" onClick={() => void reopen(last.id)}>
                Reopen
              </button>
            )}
            {last && canBill && unbilledOf(last).length > 0 && (
              <button type="button" className="ml-2 text-xs text-[var(--teal)] hover:underline" onClick={() => startBilling(last)}>
                Bill this stay
              </button>
            )}
          </p>
          {canAdmit && (
            <button type="button" className={btnSecondary} onClick={() => setSheet('admit')}>
              Admit to ward
            </button>
          )}
        </div>
      )}
      <AdmissionSheet open={sheet === 'admit'} onClose={() => setSheet(null)} patient={patient} />
      {open && (
        <>
          <AdmissionSheet open={sheet === 'edit'} onClose={() => setSheet(null)} patient={patient} stay={open} />
          <DischargeSheet
            open={sheet === 'discharge'}
            onClose={() => setSheet(null)}
            patient={patient}
            stay={open}
            onDischarged={(stay) => void offerDischargeBill(stay)}
          />
        </>
      )}
      {invoicing && <IssueInvoiceDialog clinicId={clinic.id} target={invoicing} onClose={() => setInvoicing(null)} returnTo="/patients" />}
    </section>
  );
}
