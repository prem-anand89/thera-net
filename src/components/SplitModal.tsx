import { useState } from 'react';
import { visitService } from '@/services';
import { formatINR } from '@/domain/money';
import type { Therapist, Visit } from '@/domain/types';
import { btnPrimary, btnSecondary, inputCls, ErrorNote, Field } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';

/**
 * Credits part of a visit's revenue to an assisting therapist — internal
 * only, doesn't touch the billed amount/date/therapist the hospital sees.
 * Shared by every screen with a row-level "Split revenue" action (Ledger,
 * Workspace's Today's visits) rather than each maintaining its own copy.
 */
export function SplitModal({
  visit,
  therapists,
  primaryName,
  onClose,
}: {
  visit: Visit;
  therapists: Therapist[];
  primaryName: string;
  onClose: () => void;
}) {
  const [sharedTherapistId, setSharedTherapistId] = useState(visit.sharedTherapistId ?? '');
  const [pct, setPct] = useState(visit.sharedPct != null ? String(visit.sharedPct) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pctNum = Number(pct);
  const preview =
    pctNum > 0 && pctNum <= 100 ? Math.round((visit.actualBillPaise * pctNum) / 100) : null;

  async function save(clear: boolean) {
    setError(null);
    setBusy(true);
    try {
      await visitService.setSplit(visit.id, {
        sharedTherapistId: clear ? null : sharedTherapistId || null,
        sharedPct: clear ? null : pctNum,
      });
      onClose();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-[10px] bg-[var(--surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Share visit revenue</h2>
        <p className="text-sm text-[var(--muted)]">
          Credit part of this {formatINR(visit.actualBillPaise)} visit (billed under {primaryName}) to
          an assisting therapist. This is internal only - the billed amount, date, and therapist the
          hospital sees don't change.
        </p>
        <Field label="Assisting therapist">
          <select
            className={inputCls}
            value={sharedTherapistId}
            onChange={(e) => setSharedTherapistId(e.target.value)}
          >
            <option value="">Select...</option>
            {therapists.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Their share (%)">
          <input
            type="number"
            min={1}
            max={100}
            className={inputCls}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
          />
        </Field>
        {preview != null && sharedTherapistId && (
          <p className="text-xs text-[var(--muted)]">
            {formatINR(preview)} moves to {therapists.find((t) => t.id === sharedTherapistId)?.name} in
            the Shared column; {formatINR(visit.actualBillPaise - preview)} stays with {primaryName}.
          </p>
        )}
        <ErrorNote message={error} />
        <div className="flex justify-between gap-2">
          <div>
            {visit.sharedTherapistId && (
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => void save(true)}>
                Remove split
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={busy || !sharedTherapistId || !(pctNum > 0)}
              onClick={() => void save(false)}
            >
              {busy ? 'Saving...' : 'Save split'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
