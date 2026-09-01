import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, visitService } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { formatDateDM } from '@/domain/fiscalYear';
import type { UUID } from '@/domain/types';
import { Field, inputCls, btnPrimary, btnSecondary, MultiToggle } from '@/components/ui';
import {
  BillAdjustmentFields,
  billAdjustmentFromFields,
} from '@/components/BillAdjustmentFields';
import {
  inferBillAdjustment,
  computeAdjustedBillPaise,
  type BillAdjustmentMode,
  type BillAdjustmentValueType,
} from '@/domain/billAdjustment';

/** Edits a visit's billing, therapist assignment, and clinical notes.
 *  If the visit is invoiced, only clinical fields (condition, treatmentNotes)
 *  remain editable; billing fields are frozen. */
export function EditVisitModal({
  visitId,
  onClose,
  setError,
}: {
  visitId: UUID;
  onClose: () => void;
  setError: (e: string | null) => void;
}) {
  const visit = useLiveQuery(() => repos.visits.get(visitId), [visitId]);
  const therapists = useLiveQuery(
    () => (visit ? repos.therapists.list(visit.clinicId) : undefined),
    [visit?.clinicId]
  );
  const invoice = useLiveQuery(
    () => (visit?.invoiceId ? repos.invoices.get(visit.invoiceId) : undefined),
    [visit?.invoiceId]
  );
  const patient = useLiveQuery(
    () => (visit ? repos.patients.get(visit.patientId) : undefined),
    [visit?.patientId]
  );
  const catalogItem = useLiveQuery(
    () => (visit ? repos.catalog.get(visit.serviceCatalogId) : undefined),
    [visit?.serviceCatalogId]
  );
  const treatments = useLiveQuery(
    () => (visit ? repos.treatmentCatalog.list(visit.clinicId) : undefined),
    [visit?.clinicId]
  ) ?? [];

  const [therapistId, setTherapistId] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [condition, setCondition] = useState('');
  const [treatmentNotes, setTreatmentNotes] = useState('');
  const [treatmentIds, setTreatmentIds] = useState<string[]>([]);
  const [adjustmentMode, setAdjustmentMode] = useState<BillAdjustmentMode>('none');
  const [adjustmentValueType, setAdjustmentValueType] = useState<BillAdjustmentValueType>('amount');
  const [adjustmentValue, setAdjustmentValue] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!visit || loaded) return;
    setTherapistId(visit.therapistId);
    setVisitDate(visit.visitDate);
    setCondition(visit.condition ?? '');
    setTreatmentNotes(visit.treatmentNotes ?? '');
    setTreatmentIds(visit.treatmentIds ?? []);
    const inferred = inferBillAdjustment(visit.catalogPricePaise, visit.actualBillPaise);
    setAdjustmentMode(inferred.mode);
    setAdjustmentValueType(inferred.valueType);
    setAdjustmentValue(inferred.value > 0 ? String(inferred.value) : '');
    setAdjustmentReason(visit.adjustmentReason ?? '');
    setLoaded(true);
  }, [visit, loaded]);

  if (!visit) return null;

  const frozen = visit.invoiceId !== null;
  const billPaise = computeAdjustedBillPaise(
    visit.catalogPricePaise,
    billAdjustmentFromFields(adjustmentMode, adjustmentValueType, adjustmentValue)
  );
  const adjustmentPaise = billPaise - visit.catalogPricePaise;

  async function submit() {
    setBusy(true);
    try {
      if (!frozen && adjustmentPaise !== 0 && !adjustmentReason.trim()) {
        throw new Error('Enter a reason for the bill adjustment');
      }
      await visitService.updateBilling(
        visitId,
        frozen
          ? {
              condition: condition.trim() || null,
              treatmentNotes: treatmentNotes.trim() || null,
              treatmentIds,
            }
          : {
              actualBillPaise: billPaise,
              adjustmentReason: adjustmentPaise !== 0 ? adjustmentReason.trim() : null,
              therapistId,
              visitDate,
              condition: condition.trim() || null,
              treatmentNotes: treatmentNotes.trim() || null,
              treatmentIds,
            }
      );
      onClose();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="modal-shell max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="modal-header">
          <h2>Edit visit</h2>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="modal-body space-y-4">
          <div className="text-xs text-[var(--muted)]">
            {patient?.name ?? '—'} · {catalogItem?.name ?? '—'} · {formatDateDM(visit.visitDate)}
          </div>

          {frozen && (
            <div className="rounded-md border-l-4 border-[var(--teal)] bg-[var(--teal-light)] p-3 text-xs text-[var(--ink)]">
              This visit is on invoice #{invoice?.invoiceNo ?? '—'}. Bill amount, therapist, and
              date stay as billed. Condition and treatment notes can still be updated.
            </div>
          )}

          <Field label="Condition">
            <input
              className={inputCls}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="e.g., Cervical pain"
            />
          </Field>

          <Field label="Treatments">
            <div className="space-y-2">
              {treatments.length > 0 && (
                <MultiToggle
                  options={treatments.map((t) => ({ value: t.id, label: t.name }))}
                  value={treatmentIds}
                  onChange={setTreatmentIds}
                />
              )}
              <textarea
                className={`${inputCls} min-h-20 resize-none`}
                value={treatmentNotes}
                onChange={(e) => setTreatmentNotes(e.target.value)}
                placeholder="Add something not in the list above…"
              />
            </div>
          </Field>

          {!frozen && (
            <>
              <BillAdjustmentFields
                catalogPricePaise={visit.catalogPricePaise}
                catalogLabel={catalogItem ? `Catalog — ${catalogItem.name}` : 'Catalog price'}
                mode={adjustmentMode}
                valueType={adjustmentValueType}
                value={adjustmentValue}
                reason={adjustmentReason}
                onModeChange={setAdjustmentMode}
                onValueTypeChange={setAdjustmentValueType}
                onValueChange={setAdjustmentValue}
                onReasonChange={setAdjustmentReason}
                continuationSession={visit.catalogPricePaise === 0}
              />

              <Field label="Therapist">
                <select
                  className={inputCls}
                  value={therapistId}
                  onChange={(e) => setTherapistId(e.target.value)}
                >
                  <option value="">Select a therapist</option>
                  {(therapists ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Visit date">
                <input
                  type="date"
                  className={inputCls}
                  value={visitDate}
                  onChange={(e) => setVisitDate(e.target.value)}
                />
              </Field>
            </>
          )}
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className={btnSecondary}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            onClick={submit}
            disabled={busy || (!frozen && (!therapistId || !visitDate))}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
