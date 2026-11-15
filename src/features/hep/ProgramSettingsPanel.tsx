// The program sheet's settings: patient, name, frequency, duration, start date, review, prescriber and "More settings".
// A side panel on a desktop; on a phone one summary card ("Ravi Kumar · 2× daily · 4 weeks · starts today · review in
// 7 days") that opens to the same fields. It holds no draft of its own: the sheet owns it.
import type { ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Field, filterChip, inputCls, segOption, segTrack } from '@/components/ui';
import { formatDateDM } from '@/domain/fiscalYear';
import type { SessionsPerDay } from '@/domain/hep';
import type { Therapist } from '@/domain/types';
import { SESSION_LABEL } from './ProgramItemsEditor';
import { CHECKIN_CHOICES, LENGTH_CHOICES, TARGET_CHOICES, type ProgramDraft } from './programDraft';

export const FREQUENCY_LABELS: Record<SessionsPerDay, string> = { 1: '1× daily', 2: '2× daily', 3: '3× daily' };

export interface ProgramSettingsPanelProps {
  draft: ProgramDraft;
  set: (patch: Partial<ProgramDraft>) => void;
  onFrequency: (n: SessionsPerDay) => void;
  /** Editing the live program: a review date instead of "Review in", no start date. */
  editing: boolean;
  /** The live program's frequency, for the "starts tomorrow" note. */
  liveSessionsPerDay?: SessionsPerDay;
  /** The visit's date, when prescribing from a visit note. */
  startDate?: string;
  therapists: Therapist[];
  /** The patient field (search, browse, new patient), or null when the patient is fixed. */
  patientField: ReactNode;
}

/** "Ravi Kumar · 2× daily · 4 weeks · starts today · review in 7 days". */
export function settingsSummary(d: ProgramDraft, opts: { patientName: string | null; editing: boolean; startDate?: string }): string {
  const length = LENGTH_CHOICES.find((c) => c.days === d.durationDays)?.label.toLowerCase() ?? (d.durationDays == null ? 'ongoing' : `${d.durationDays} days`);
  const start = opts.editing ? null : opts.startDate ? `starts ${formatDateDM(opts.startDate)}` : d.startOffset === 0 ? 'starts today' : 'starts tomorrow';
  const review = opts.editing ? (d.checkinOn ? `review on ${d.checkinOn}` : 'no review') : d.checkinDays ? `review in ${d.checkinDays} days` : 'no review';
  return [opts.patientName ?? 'No patient chosen', FREQUENCY_LABELS[d.sessionsPerDay], length, start, review].filter(Boolean).join(' · ');
}

export function ProgramSettingsPanel({ draft, set, onFrequency, editing, liveSessionsPerDay, startDate, therapists, patientField }: ProgramSettingsPanelProps) {
  return (
    <div className="space-y-4">
      {patientField}

      <Field label="Program name" hint="The patient sees this name. A plain name works best, for example “Right knee, week 2”.">
        <input className={inputCls} value={draft.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
      </Field>

      <div className="space-y-1.5">
        <div className="text-label font-medium text-[var(--muted)]">Frequency</div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Frequency">
          {([1, 2, 3] as SessionsPerDay[]).map((n) => <button key={n} type="button" aria-pressed={draft.sessionsPerDay === n} className={filterChip(draft.sessionsPerDay === n)} onClick={() => onFrequency(n)}>{FREQUENCY_LABELS[n]}</button>)}
        </div>
        {editing && liveSessionsPerDay && draft.sessionsPerDay !== liveSessionsPerDay && <p className="text-hint text-[var(--muted)]">Today stays {SESSION_LABEL[liveSessionsPerDay]}; the new number starts tomorrow.</p>}
      </div>

      <div className="space-y-1.5">
        <div className="text-label font-medium text-[var(--muted)]">Duration</div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Duration">
          {LENGTH_CHOICES.map((c) => <button key={c.label} type="button" aria-pressed={draft.durationDays === c.days} className={filterChip(draft.durationDays === c.days)} onClick={() => set({ durationDays: c.days })}>{c.label}</button>)}
        </div>
      </div>

      {!editing && (
        <div className="space-y-1.5">
          <div className="text-label font-medium text-[var(--muted)]">Start date</div>
          {startDate ? <p className="text-sm text-[var(--ink)]">On the visit date ({formatDateDM(startDate)})</p> : (
            <div className="flex gap-1.5" role="group" aria-label="Start date">
              <button type="button" aria-pressed={draft.startOffset === 0} className={filterChip(draft.startOffset === 0)} onClick={() => set({ startOffset: 0 })}>Today</button>
              <button type="button" aria-pressed={draft.startOffset === 1} className={filterChip(draft.startOffset === 1)} onClick={() => set({ startOffset: 1 })}>Tomorrow</button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="text-label font-medium text-[var(--muted)]">Review in</div>
        {editing ? (
          <div className="flex items-center gap-2">
            <input type="date" className={`${inputCls} !w-auto`} aria-label="Review on" value={draft.checkinOn ?? ''} onChange={(e) => set({ checkinOn: e.target.value || null })} />
            {draft.checkinOn && <Button type="button" className="text-xs text-[var(--teal)]" onClick={() => set({ checkinOn: null })}>No review</Button>}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Review in">
            {CHECKIN_CHOICES.map((c) => <button key={c.label} type="button" aria-pressed={draft.checkinDays === c.days} className={filterChip(draft.checkinDays === c.days)} onClick={() => set({ checkinDays: c.days })}>{c.label}</button>)}
          </div>
        )}
      </div>

      <Field label="Prescribed by">
        <select className={inputCls} value={draft.therapistId ?? ''} onChange={(e) => set({ therapistId: e.target.value || null })}>
          <option value="">Not set</option>
          {therapists.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>

      <details className="rounded-xl border border-[var(--border)] p-3">
        <summary className="cursor-pointer text-sm font-medium text-[var(--ink)]">More settings</summary>
        <div className="mt-3 space-y-4">
          <div className="space-y-1.5">
            <div className="text-label font-medium text-[var(--muted)]">Session feedback</div>
            <div className={segTrack} role="group" aria-label="Session feedback">
              <button type="button" aria-pressed={draft.feedbackDefault === 'pain'} className={segOption(draft.feedbackDefault === 'pain')} onClick={() => set({ feedbackDefault: 'pain' })}>Pain first</button>
              <button type="button" aria-pressed={draft.feedbackDefault === 'effort'} className={segOption(draft.feedbackDefault === 'effort')} onClick={() => set({ feedbackDefault: 'effort' })}>Effort first</button>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-label font-medium text-[var(--muted)]">Completion target</div>
            <div className="flex gap-1.5" role="group" aria-label="Completion target">
              {TARGET_CHOICES.map((n) => <button key={n} type="button" aria-pressed={draft.targetPct === n} className={filterChip(draft.targetPct === n)} onClick={() => set({ targetPct: n })}>{n}%</button>)}
            </div>
          </div>
          <Field label="Custom PIN (optional)" hint="Four digits. Leave empty for a random PIN. It is shown once after saving.">
            <input className={`${inputCls} !w-28`} inputMode="numeric" maxLength={4} autoComplete="off" value={draft.customPin} onChange={(e) => set({ customPin: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
          </Field>
        </div>
      </details>
    </div>
  );
}

