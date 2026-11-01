import { Field, inputCls, Segmented } from '@/components/ui';
import { draftBadge, SPLIT_MIN_GAP_MINUTES, switchMode, type ShiftDraft, type ShiftMode } from './shiftDraft';
import { minutesToTimeInput, timeInputToMinutes } from './shiftUtils';

const MODES: { value: ShiftMode; label: string; hint: string }[] = [
  { value: 'continuous', label: 'Continuous', hint: 'One stretch, with an optional lunch' },
  { value: 'split', label: 'Split', hint: 'Morning and evening sessions with a long gap (2 hours or more)' },
];

function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (minutes: number) => void }) {
  return (
    <Field label={label}>
      <input type="time" className={inputCls} value={minutesToTimeInput(value)} onChange={(e) => onChange(timeInputToMinutes(e.target.value))} />
    </Field>
  );
}

/**
 * The times of a shift template, in the two ways clinics actually run: a continuous shift (start, end, optional lunch)
 * or a split shift (a morning session and an evening session). One editor for adding and editing; `shiftDraft.ts`
 * holds the rules and the mapping to the stored fields. Shows what the shift adds up to as you type.
 */
export function ShiftTimesEditor({ draft, onChange }: { draft: ShiftDraft; onChange: (next: ShiftDraft) => void }) {
  const patch = (p: Partial<ShiftDraft>) => onChange({ ...draft, ...p });
  const gap = draft.s2Start - draft.s1End;
  return (
    <div className="space-y-3" data-testid="shift-times-editor">
      <div className="flex items-center justify-between gap-2">
        <Segmented label="Shift type" options={MODES} value={draft.mode} onChange={(mode) => onChange(switchMode(draft, mode))} />
        <span className="text-xs font-medium text-[var(--teal)]" data-testid="shift-badge">
          {draftBadge(draft)}
        </span>
      </div>

      {draft.mode === 'continuous' ? (
        <>
          <div className="grid grid-cols-2 items-end gap-3 [&_input]:min-w-0">
            <TimeField label="Start time" value={draft.start} onChange={(start) => patch({ start })} />
            <TimeField label="End time" value={draft.end} onChange={(end) => patch({ end })} />
          </div>
          <div className="grid grid-cols-2 items-end gap-3 [&_input]:min-w-0">
            <Field label="Lunch (minutes, 0 for none)">
              <input
                type="number"
                min={0}
                className={inputCls}
                value={draft.lunchMinutes}
                onChange={(e) => patch({ lunchMinutes: Math.max(0, Number(e.target.value) || 0) })}
              />
            </Field>
            {draft.lunchMinutes > 0 && <TimeField label="Lunch starts" value={draft.lunchStart} onChange={(lunchStart) => patch({ lunchStart })} />}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs font-medium text-[var(--ink)]">Session 1</p>
          <div className="grid grid-cols-2 items-end gap-3 [&_input]:min-w-0">
            <TimeField label="Session 1 starts" value={draft.s1Start} onChange={(s1Start) => patch({ s1Start })} />
            <TimeField label="Session 1 ends" value={draft.s1End} onChange={(s1End) => patch({ s1End })} />
          </div>
          <p className="text-xs font-medium text-[var(--ink)]">Session 2</p>
          <div className="grid grid-cols-2 items-end gap-3 [&_input]:min-w-0">
            <TimeField label="Session 2 starts" value={draft.s2Start} onChange={(s2Start) => patch({ s2Start })} />
            <TimeField label="Session 2 ends" value={draft.s2End} onChange={(s2End) => patch({ s2End })} />
          </div>
          {gap > 0 && gap < SPLIT_MIN_GAP_MINUTES && (
            <p className="text-[11px] text-[var(--amber)]">For breaks under 2 hours, use Continuous shift with a break.</p>
          )}
        </>
      )}
    </div>
  );
}
