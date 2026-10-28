import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FOLLOW_UP_PRESETS, followUpDateFor } from '@/domain/followUp';
import { formatDateDMY } from '@/domain/fiscalYear';
import { toLocalDateStr } from '@/domain/schedule';
import type { UUID } from '@/domain/types';
import { toFriendlyMessage } from '@/lib/errors';
import { patientService, repos } from '@/services';
import { FollowUpDialog } from './FollowUpDialog';

/**
 * The one-tap row on the "Visit logged" screen: *Ask them back in 2 days · 3 days · 1 week · date…*. A tap sets the
 * follow-up for the visit's therapist and the row turns into "Review set for Fri 30 Oct · Change". Sets a target
 * date only; the patient is messaged and a time booked later from the Workspace "Follow up" card.
 */
export function FollowUpQuickRow({ patientId, therapistId }: { patientId: UUID; therapistId: UUID }) {
  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!patient) return null;
  const today = toLocalDateStr(new Date());

  async function pick(key: (typeof FOLLOW_UP_PRESETS)[number]['key']) {
    setBusy(true);
    setError(null);
    try {
      await patientService.setFollowUp(patientId, { on: followUpDateFor(key, today), therapistId });
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5" data-testid="follow-up-row">
      {patient.followUpOn ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-[var(--teal)] bg-[var(--teal-light)]/40 px-3 py-2">
          <p className="text-xs text-[var(--ink)]">
            <span aria-hidden="true">✓ </span>
            Review set for <strong>{formatDateDMY(patient.followUpOn)}</strong>
            {patient.followUpNote ? <span className="text-[var(--muted)]"> · {patient.followUpNote}</span> : null}
          </p>
          <button type="button" className="min-h-9 text-xs font-medium text-[var(--teal)]" onClick={() => setDialog(true)}>
            Change
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">Ask them back for a review?</h4>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOW_UP_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                disabled={busy}
                onClick={() => void pick(preset.key)}
                className="min-h-9 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--ink)] hover:border-[var(--teal)] disabled:opacity-50"
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDialog(true)}
              className="min-h-9 rounded-full border border-dashed border-[var(--border)] px-3 text-xs font-medium text-[var(--teal)] hover:border-[var(--teal)]"
            >
              Pick a date…
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-[var(--rust)]">{error}</p>}
      <FollowUpDialog open={dialog} patientId={patientId} defaultTherapistId={therapistId} onClose={() => setDialog(false)} />
    </div>
  );
}
