import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, visitService } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { paiseToRupees, rupeesToPaise } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import type { UUID } from '@/domain/types';
import { Field, inputCls, btnPrimary, btnSecondary } from '@/components/ui';

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

  const [therapistId, setTherapistId] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [condition, setCondition] = useState('');
  const [treatmentNotes, setTreatmentNotes] = useState('');
  const [billRupees, setBillRupees] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!visit || loaded) return;
    setTherapistId(visit.therapistId);
    setVisitDate(visit.visitDate);
    setCondition(visit.condition ?? '');
    setTreatmentNotes(visit.treatmentNotes ?? '');
    setBillRupees(paiseToRupees(visit.actualBillPaise).toString());
    setAdjustmentReason(visit.adjustmentReason ?? '');
    setLoaded(true);
  }, [visit, loaded]);

  if (!visit) return null;

  const frozen = visit.invoiceId !== null;

  async function submit() {
    setBusy(true);
    try {
      await visitService.updateBilling(
        visitId,
        frozen
          ? {
              condition: condition.trim() || null,
              treatmentNotes: treatmentNotes.trim() || null,
            }
          : {
              actualBillPaise: rupeesToPaise(Number(billRupees)),
              adjustmentReason: adjustmentReason.trim() || null,
              therapistId,
              visitDate,
              condition: condition.trim() || null,
              treatmentNotes: treatmentNotes.trim() || null,
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
            {patient?.name ?? '—'} · {catalogItem?.name ?? '—'} · {formatDateDMY(visit.visitDate)}
          </div>

          {frozen && (
            <div className="rounded-md border-l-4 border-[var(--rust)] bg-[var(--rust-light)] p-3 text-xs">
              🔒 <strong>Frozen</strong> — This visit is on invoice #{invoice?.invoiceNo ?? '—'}.
              <br />
              Only clinical notes can be edited.
            </div>
          )}

          {!frozen && (
            <>
              <Field label="Bill amount (₹)">
                <input
                  type="number"
                  className={inputCls}
                  value={billRupees}
                  onChange={(e) => setBillRupees(e.target.value)}
                  step="0.01"
                  min="0"
                />
              </Field>

              <Field label="Adjustment reason">
                <input
                  className={inputCls}
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  placeholder="Required if bill differs from catalog price"
                />
              </Field>

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

          <Field label="Condition">
            <input
              className={inputCls}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="e.g., Cervical pain"
            />
          </Field>

          <Field label="Treatment notes">
            <textarea
              className={`${inputCls} min-h-20 resize-none`}
              value={treatmentNotes}
              onChange={(e) => setTreatmentNotes(e.target.value)}
              placeholder="Clinical notes about the treatment"
            />
          </Field>
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
