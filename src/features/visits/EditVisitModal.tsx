import { useEffect, useState } from 'react';
import { repos, visitService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import type { Visit, UUID } from '@/domain/types';
import { toFriendlyMessage } from '@/lib/errors';
import { Field, inputCls, btnPrimary, btnSecondary, ErrorNote } from '@/components/ui';

export function EditVisitModal({
  visitId,
  onClose,
  onSave,
}: {
  visitId: UUID;
  onClose: () => void;
  onSave: (updated: Visit) => void;
}) {
  const clinic = useClinic();
  const [visit, setVisit] = useState<Visit | null>(null);
  const [therapists, setTherapists] = useState<{ id: UUID; name: string }[]>([]);
  const [catalog, setCatalog] = useState<{ id: UUID; name: string; category: string }[]>([]);

  const [visitDate, setVisitDate] = useState('');
  const [therapistId, setTherapistId] = useState('');
  const [condition, setCondition] = useState('');
  const [treatmentNotes, setTreatmentNotes] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [v, t, c] = await Promise.all([
          repos.visits.get(visitId),
          repos.therapists.list(clinic.id),
          repos.catalog.list(clinic.id),
        ]);

        if (!v) {
          setError('Visit not found');
          return;
        }

        setVisit(v);
        setTherapists(t);
        setCatalog(c);
        setVisitDate(v.visitDate);
        setTherapistId(v.therapistId);
        setCondition(v.condition ?? '');
        setTreatmentNotes(v.treatmentNotes ?? '');
      } catch (e) {
        setError(toFriendlyMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [visitId, clinic.id]);

  async function handleSave() {
    setError(null);
    if (!visit) return;
    if (!therapistId) return setError('Therapist is required');

    setBusy(true);
    try {
      const updated = await visitService.updateBilling(visit.id, {
        visitDate,
        therapistId,
        condition: condition || null,
        treatmentNotes: treatmentNotes || null,
      });
      onSave(updated);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="w-96 rounded-lg bg-[var(--surface)] p-6 shadow-lg">
          <p className="text-center text-sm text-[var(--muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-96 rounded-lg bg-[var(--surface)] p-6 shadow-lg">
        <h2 className="font-display text-lg font-semibold text-[var(--ink)]">Edit visit</h2>

        <div className="mt-4 space-y-3">
          {error && <ErrorNote message={error} />}

          <Field label="Date *">
            <input
              type="date"
              className={inputCls}
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
            />
          </Field>

          <Field label="Therapist *">
            <select
              className={inputCls}
              value={therapistId}
              onChange={(e) => setTherapistId(e.target.value)}
            >
              <option value="">Select…</option>
              {therapists.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Service">
            <div className="rounded bg-[var(--paper)] px-3 py-2 text-sm text-[var(--muted)]">
              {visit && catalog.find((c) => c.id === visit.serviceCatalogId)?.name || 'Unknown service'}
            </div>
          </Field>

          <Field label="Condition">
            <input
              className={inputCls}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="e.g. Back pain"
            />
          </Field>

          <Field label="Treatment notes">
            <textarea
              className={inputCls}
              value={treatmentNotes}
              onChange={(e) => setTreatmentNotes(e.target.value)}
              placeholder="What was done during the visit"
              rows={3}
            />
          </Field>
        </div>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className={btnPrimary}
            disabled={busy}
            onClick={handleSave}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            className={btnSecondary}
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
