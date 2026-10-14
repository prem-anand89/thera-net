import { askConfirm } from '@/components/notify';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { repos, bookingService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { ErrorNote, Field, inputCls, btnPrimary, btnSecondary } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import {
  formatRange12h,
  formatShiftSummary,
  getTemplatePalette,
  minutesToTimeInput,
  templateUsage,
  timeInputToMinutes,
  validateShiftTemplate,
} from './shiftUtils';
import type { ShiftTemplate } from '@/domain/types';

function ShiftTemplateCard({
  template,
  usedByTherapistNames,
}: {
  template: ShiftTemplate;
  usedByTherapistNames: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(template.name);
  const [start, setStart] = useState(minutesToTimeInput(template.startMinute));
  const [end, setEnd] = useState(minutesToTimeInput(template.endMinute));
  const [breakDuration, setBreakDuration] = useState(String(template.breakDurationMinutes));
  const [breakStart, setBreakStart] = useState(
    template.defaultBreakStartMinute !== null ? minutesToTimeInput(template.defaultBreakStartMinute) : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startMin = timeInputToMinutes(start);
  const endMin = timeInputToMinutes(end);
  const breakMin = Number(breakDuration) || 0;
  const breakStartMin = breakStart ? timeInputToMinutes(breakStart) : null;

  const validation = validateShiftTemplate(name, startMin, endMin, breakMin, breakStartMin);
  const shiftInfo = formatShiftSummary(template);
  const palette = getTemplatePalette(template.id);

  async function save() {
    if (!validation.valid) {
      setError(validation.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await bookingService.updateShiftTemplate({
        templateId: template.id,
        name: name.trim(),
        startMinute: startMin,
        endMinute: endMin,
        breakDurationMinutes: breakMin,
        defaultBreakStartMinute: breakStartMin,
        active: template.active,
      });
      setEditing(false);
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    setSaving(true);
    setError(null);
    try {
      await bookingService.updateShiftTemplate({
        templateId: template.id,
        name: template.name,
        startMinute: template.startMinute,
        endMinute: template.endMinute,
        breakDurationMinutes: template.breakDurationMinutes,
        defaultBreakStartMinute: template.defaultBreakStartMinute,
        active: !template.active,
      });
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (usedByTherapistNames.length > 0) {
      setError(`Cannot delete template while assigned to ${usedByTherapistNames.join(', ')}.`);
      return;
    }
    const ok = await askConfirm({
      title: 'Delete this shift template?',
      message: `Permanently delete "${template.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await bookingService.deleteShiftTemplate(template.id);
      await db.shift_templates.update(template.id, {
        removedAt: new Date().toISOString(),
        active: false,
      });
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    const liveWorkingMinutes = Math.max(0, endMin - startMin - breakMin);
    const liveWorkingHours = (liveWorkingMinutes / 60).toFixed(
      liveWorkingMinutes % 60 === 0 ? 0 : 1
    );

    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3 shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[var(--ink)]">Editing {template.name}</span>
          <span className="text-xs text-[var(--teal)] font-medium">
            Working time: {liveWorkingHours}h/shift
          </span>
        </div>

        {usedByTherapistNames.length > 0 && (
          <div className="rounded-xl border border-[var(--amber)] bg-[var(--amber-light)]/40 p-2 text-xs text-[var(--ink)]">
            ⚠️ <strong>Impact warning:</strong> Currently assigned to {usedByTherapistNames.join(', ')}.
            Updating this template modifies their scheduled hours immediately.
          </div>
        )}

        <Field label="Shift Name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Time">
            <input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End Time">
            <input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Break Duration (minutes)">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={breakDuration}
              onChange={(e) => setBreakDuration(e.target.value)}
            />
          </Field>
          <Field label="Default Break Start">
            <input
              type="time"
              className={inputCls}
              value={breakStart}
              onChange={(e) => setBreakStart(e.target.value)}
            />
          </Field>
        </div>

        {breakMin >= 120 && (
          <p className="text-[11px] font-medium text-[var(--teal)]">
            ✨ Break is &ge; 2h: This shift will be treated as a Split Shift schedule.
          </p>
        )}

        <ErrorNote message={error || (!validation.valid ? validation.error : null)} />

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            className={btnSecondary}
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => void save()}
            disabled={saving || !validation.valid}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-all shadow-xs ${
        !template.active ? 'opacity-60 bg-[var(--paper)]' : ''
      }`}
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${palette.bg} ${palette.border} border`}
              aria-hidden
            />
            <h3 className="font-semibold text-sm text-[var(--ink)]">{template.name}</h3>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              usedByTherapistNames.length > 0
                ? 'bg-[var(--teal-light)] text-[var(--teal)]'
                : 'bg-[var(--paper)] text-[var(--muted)]'
            }`}
          >
            {usedByTherapistNames.length > 0
              ? `Used by ${usedByTherapistNames.length}`
              : 'Unassigned'}
          </span>
        </div>

        {shiftInfo.isSplit && shiftInfo.splitDetails ? (
          <div className="space-y-0.5">
            <span className="inline-block rounded bg-[var(--teal-light)]/40 px-1.5 py-0.2 text-[10px] font-bold text-[var(--teal)]">
              SPLIT SHIFT
            </span>
            <p className="text-xs text-[var(--muted)]">{shiftInfo.splitDetails}</p>
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">
            {formatRange12h(template.startMinute, template.endMinute)}
            {template.breakDurationMinutes > 0 &&
              ` · ${template.breakDurationMinutes}-min break`}
          </p>
        )}

        {usedByTherapistNames.length > 0 && (
          <p className="text-[11px] text-[var(--muted)] truncate">
            Staff: {usedByTherapistNames.join(', ')}
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2.5 text-xs font-medium">
        <button
          type="button"
          className="text-[var(--teal)] hover:opacity-80 inline-flex min-h-8 items-center px-1"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
        <div className="flex items-center gap-2">
          {(!template.active || usedByTherapistNames.length === 0) && (
            <button
              type="button"
              className="text-[var(--rust)] hover:opacity-80 inline-flex min-h-8 items-center px-1"
              onClick={() => void handleDelete()}
              disabled={saving}
              title="Delete this template"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            className={`inline-flex min-h-8 items-center px-1 ${
              template.active ? 'text-[var(--muted)]' : 'text-[var(--teal)]'
            } hover:opacity-80`}
            onClick={() => void toggleActive()}
            disabled={saving}
          >
            {template.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </div>
      <ErrorNote message={error} />
    </div>
  );
}

function ShiftTemplateAddForm({
  clinicId,
  isOpen,
  onClose,
}: {
  clinicId: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [breakDuration, setBreakDuration] = useState('60');
  const [breakStart, setBreakStart] = useState('13:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const startMin = timeInputToMinutes(start);
  const endMin = timeInputToMinutes(end);
  const breakMin = Number(breakDuration) || 0;
  const breakStartMin = breakStart ? timeInputToMinutes(breakStart) : null;

  const validation = validateShiftTemplate(name, startMin, endMin, breakMin, breakStartMin);
  const liveWorkingMinutes = Math.max(0, endMin - startMin - breakMin);
  const liveWorkingHours = (liveWorkingMinutes / 60).toFixed(
    liveWorkingMinutes % 60 === 0 ? 0 : 1
  );

  async function add() {
    if (!validation.valid) {
      setError(validation.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await bookingService.createShiftTemplate({
        clinicId,
        name: name.trim(),
        startMinute: startMin,
        endMinute: endMin,
        breakDurationMinutes: breakMin,
        defaultBreakStartMinute: breakStartMin,
      });
      setName('');
      setBreakDuration('0');
      setBreakStart('');
      onClose();
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--teal)]/40 bg-[var(--surface)] p-4 space-y-3 shadow-md animate-in fade-in duration-150">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
        <h3 className="font-semibold text-sm text-[var(--ink)]">Add new shift template</h3>
        <span className="text-xs text-[var(--teal)] font-medium">
          Working time: {liveWorkingHours}h/shift
        </span>
      </div>

      <Field label="Shift Name">
        <input
          className={inputCls}
          placeholder="e.g. Morning Shift, General Shift"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Start Time">
          <input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End Time">
          <input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Break Duration (minutes)">
          <input
            type="number"
            min={0}
            className={inputCls}
            value={breakDuration}
            onChange={(e) => setBreakDuration(e.target.value)}
          />
        </Field>
        <Field label="Default Break Start">
          <input
            type="time"
            className={inputCls}
            value={breakStart}
            onChange={(e) => setBreakStart(e.target.value)}
          />
        </Field>
      </div>

      {breakMin >= 120 && (
        <p className="text-[11px] font-medium text-[var(--teal)]">
          ✨ Break is &ge; 2h: This shift will be formatted as a Split Shift schedule.
        </p>
      )}

      <ErrorNote message={error || (!validation.valid ? validation.error : null)} />

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          className={btnSecondary}
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className={btnPrimary}
          onClick={() => void add()}
          disabled={saving || !validation.valid}
        >
          {saving ? 'Creating…' : 'Create shift template'}
        </button>
      </div>
    </div>
  );
}

export function ShiftTemplatesSection() {
  const clinic = useClinic();
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinic.id, true), [clinic.id]);
  const assignments = useLiveQuery(() => repos.therapistShiftAssignments.listByClinic(clinic.id), [clinic.id]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const therapistMap = useMemo(
    () => new Map((therapists ?? []).map((t) => [t.id, t.name])),
    [therapists]
  );

  const activeTemplates = useMemo(
    () => (templates ?? []).filter((t) => t.active),
    [templates]
  );
  const inactiveTemplates = useMemo(
    () => (templates ?? []).filter((t) => !t.active),
    [templates]
  );

  return (
    <div className="space-y-4 pt-4 border-t border-[var(--border)]" data-testid="shift-templates-section">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-[var(--ink)]">
            Shift templates
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Reusable shift hours and break configurations assigned to team members.
          </p>
        </div>
        {!isAddOpen && (
          <button
            type="button"
            className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--ink)] shadow-xs hover:bg-[var(--paper)] transition"
            onClick={() => setIsAddOpen(true)}
          >
            + Add shift template
          </button>
        )}
      </div>

      <ShiftTemplateAddForm
        clinicId={clinic.id}
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
      />

      {/* Active Templates Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {activeTemplates.map((template) => {
          const userIds = templateUsage(template.id, assignments ?? []);
          const names = userIds.map((id) => therapistMap.get(id) ?? 'Staff');
          return (
            <ShiftTemplateCard
              key={template.id}
              template={template}
              usedByTherapistNames={names}
            />
          );
        })}
      </div>

      {activeTemplates.length === 0 && !isAddOpen && (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">
          No shift templates created yet. Click &ldquo;+ Add shift template&rdquo; to build your first template.
        </div>
      )}

      {/* Inactive Templates Toggle */}
      {inactiveTemplates.length > 0 && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowInactive(!showInactive)}
            className="text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] flex items-center gap-1.5"
          >
            <span>{showInactive ? '▼' : '▶'}</span>
            Show inactive templates ({inactiveTemplates.length})
          </button>

          {showInactive && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-3">
              {inactiveTemplates.map((template) => {
                const userIds = templateUsage(template.id, assignments ?? []);
                const names = userIds.map((id) => therapistMap.get(id) ?? 'Staff');
                return (
                  <ShiftTemplateCard
                    key={template.id}
                    template={template}
                    usedByTherapistNames={names}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
