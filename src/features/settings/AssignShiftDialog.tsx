import { useMemo, useState } from 'react';
import { bookingService } from '@/services';
import { ErrorNote, Field, inputCls, btnPrimary, btnSecondary } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import {
  WEEKDAY_META,
  WEEKDAY_ORDER,
  formatRange12h,
  minutesToTimeInput,
  previewAssign,
  sortWeekdays,
  timeInputToMinutes,
} from './shiftUtils';
import type {
  Clinic,
  ShiftTemplate,
  Therapist,
  TherapistShiftAssignment,
} from '@/domain/types';

export type AssignShiftDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  initialTherapistId?: string | null;
  initialWeekday?: number | null;
  therapists: Therapist[];
  templates: ShiftTemplate[];
  approvedAssignments: TherapistShiftAssignment[];
  pendingAssignments: TherapistShiftAssignment[];
  clinic: Clinic;
};

const CLINIC_DEFAULT_ID = '__clinic_default__';

export function AssignShiftDialog({
  isOpen,
  onClose,
  initialTherapistId,
  initialWeekday,
  therapists,
  templates,
  approvedAssignments,
  pendingAssignments,
  clinic,
}: AssignShiftDialogProps) {
  const activeTherapists = useMemo(
    () => therapists.filter((t) => t.active !== false),
    [therapists]
  );
  const activeTemplates = useMemo(
    () => templates.filter((t) => t.active),
    [templates]
  );

  const [selectedTherapistIds, setSelectedTherapistIds] = useState<string[]>(() =>
    initialTherapistId ? [initialTherapistId] : []
  );
  const [selectedShiftId, setSelectedShiftId] = useState<string>(() =>
    activeTemplates.length > 0 ? activeTemplates[0].id : CLINIC_DEFAULT_ID
  );
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(() =>
    initialWeekday !== null && initialWeekday !== undefined ? [initialWeekday] : [1, 2, 3, 4, 5]
  );
  const [breakStartOverride, setBreakStartOverride] = useState('');
  const [showBreakOverride, setShowBreakOverride] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isClinicDefault = selectedShiftId === CLINIC_DEFAULT_ID;
  const pickedTemplate = activeTemplates.find((t) => t.id === selectedShiftId) ?? null;

  // Selected therapist objects
  const pickedTherapists = activeTherapists.filter((t) =>
    selectedTherapistIds.includes(t.id)
  );

  // Dynamic presets
  const closedDays = new Set(clinic.closedWeekdays ?? []);
  const openDaysPreset = WEEKDAY_ORDER.filter((d) => !closedDays.has(d));
  const monFriPreset = [1, 2, 3, 4, 5];
  const everyDayPreset = [...WEEKDAY_ORDER];

  // Break validation if template and override used
  let breakOverrideError: string | null = null;
  let parsedBreakStart: number | null = null;
  if (pickedTemplate && showBreakOverride && breakStartOverride) {
    parsedBreakStart = timeInputToMinutes(breakStartOverride);
    if (parsedBreakStart < pickedTemplate.startMinute) {
      breakOverrideError = 'Break cannot start before shift starts.';
    } else if (
      parsedBreakStart + pickedTemplate.breakDurationMinutes >
      pickedTemplate.endMinute
    ) {
      breakOverrideError = 'Break must finish before shift ends.';
    }
  }

  // Live preview
  const preview = previewAssign({
    therapists: pickedTherapists,
    weekdays: selectedWeekdays,
    template: pickedTemplate,
    isClinicDefault,
    existingApproved: approvedAssignments,
    existingPending: pendingAssignments,
    clinic,
  });

  // Toggle therapist selection
  function toggleTherapist(id: string) {
    setSelectedTherapistIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // Toggle weekday selection
  function toggleWeekday(day: number) {
    setSelectedWeekdays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : sortWeekdays([...prev, day])
    );
  }

  // Submit action
  async function handleSubmit() {
    if (selectedTherapistIds.length === 0) return;
    if (!isClinicDefault && selectedWeekdays.length === 0) return;
    if (breakOverrideError) return;

    setSaving(true);
    setError(null);

    const failedIds: string[] = [];
    let lastErrorMessage: string | null = null;

    for (const tId of selectedTherapistIds) {
      try {
        if (isClinicDefault) {
          // Resetting to clinic default
          await bookingService.assignCustomHours(tId, null);
        } else if (pickedTemplate) {
          await bookingService.assignShift({
            therapistId: tId,
            shiftTemplateId: pickedTemplate.id,
            weekdays: selectedWeekdays,
            breakStartMinute: parsedBreakStart,
          });
        }
      } catch (err) {
        failedIds.push(tId);
        lastErrorMessage = toFriendlyMessage(err);
      }
    }

    setSaving(false);

    if (failedIds.length === 0) {
      onClose();
    } else {
      // Partial failure handling
      setSelectedTherapistIds(failedIds);
      setError(
        failedIds.length === 1
          ? `Failed to assign shift for 1 therapist: ${lastErrorMessage}`
          : `Failed for ${failedIds.length} therapists. You can retry remaining.`
      );
    }
  }

  const clinicStart = (clinic.bookingStartHour ?? 9) * 60;
  const clinicEnd = (clinic.bookingEndHour ?? 18) * 60;

  const canSubmit =
    selectedTherapistIds.length > 0 &&
    (isClinicDefault || selectedWeekdays.length > 0) &&
    !breakOverrideError &&
    !saving;

  const submitLabel = saving
    ? 'Assigning…'
    : isClinicDefault
    ? `Reset ${selectedTherapistIds.length} therapist${
        selectedTherapistIds.length === 1 ? '' : 's'
      } to Clinic Default`
    : `Assign to ${selectedTherapistIds.length} therapist${
        selectedTherapistIds.length === 1 ? '' : 's'
      }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label="Assign shift"
    >
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
          <div>
            <h2 className="font-display text-lg font-bold text-[var(--ink)]">
              {isClinicDefault ? 'Set Clinic Default Hours' : 'Assign Shift'}
            </h2>
            <p className="text-xs text-[var(--muted)]">
              Select team members, shift pattern, and working days.
            </p>
          </div>
          <button
            type="button"
            className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
            onClick={onClose}
            aria-label="Close dialog"
            disabled={saving}
          >
            ✕
          </button>
        </div>

        {/* 1. Therapist Selection */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Team Members ({selectedTherapistIds.length} selected)
          </label>
          <div className="flex flex-wrap gap-1.5">
            {activeTherapists.map((t) => {
              const isSelected = selectedTherapistIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTherapist(t.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                    isSelected
                      ? 'bg-[var(--teal)] text-white shadow-sm'
                      : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--paper)]'
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: isSelected ? 'white' : t.color ?? '#2c5f63' }}
                    aria-hidden
                  />
                  {t.name}
                </button>
              );
            })}
          </div>
          {selectedTherapistIds.length === 0 && (
            <p className="text-[11px] text-[var(--rust)]">Please select at least one therapist.</p>
          )}
        </div>

        {/* 2. Shift Pattern Dropdown */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Shift Schedule
          </label>
          <select
            className={inputCls}
            value={selectedShiftId}
            onChange={(e) => setSelectedShiftId(e.target.value)}
          >
            <option value={CLINIC_DEFAULT_ID}>
              🏢 Clinic Default Hours ({formatRange12h(clinicStart, clinicEnd)})
            </option>
            {activeTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({formatRange12h(t.startMinute, t.endMinute)}
                {t.breakDurationMinutes > 0 ? `, ${t.breakDurationMinutes}m break` : ''})
              </option>
            ))}
          </select>
        </div>

        {/* 3. Working Days Selection (Only when not resetting to clinic default) */}
        {!isClinicDefault && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Active Weekdays
              </label>
              {/* Presets */}
              <div className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setSelectedWeekdays(openDaysPreset)}
                  className="rounded px-2 py-0.5 font-medium text-[var(--teal)] hover:bg-[var(--teal-light)]/40"
                >
                  Open days
                </button>
                <span className="text-[var(--border)]">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedWeekdays(monFriPreset)}
                  className="rounded px-2 py-0.5 font-medium text-[var(--teal)] hover:bg-[var(--teal-light)]/40"
                >
                  Mon–Fri
                </button>
                <span className="text-[var(--border)]">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedWeekdays(everyDayPreset)}
                  className="rounded px-2 py-0.5 font-medium text-[var(--teal)] hover:bg-[var(--teal-light)]/40"
                >
                  All days
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAY_ORDER.map((day) => {
                const isSelected = selectedWeekdays.includes(day);
                const isClosed = closedDays.has(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleWeekday(day)}
                    className={`flex flex-col items-center justify-center rounded-xl py-2 text-center transition ${
                      isSelected
                        ? 'bg-[var(--teal)] text-white shadow-sm'
                        : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--paper)]'
                    }`}
                  >
                    <span className="text-xs font-bold">{WEEKDAY_META[day]?.short}</span>
                    {isClosed && (
                      <span className={`text-[9px] ${isSelected ? 'text-white/80' : 'text-[var(--muted)]'}`}>
                        Closed
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {selectedWeekdays.length === 0 && (
              <p className="text-[11px] text-[var(--rust)]">Please pick at least one working day.</p>
            )}
          </div>
        )}

        {/* 4. Break Override (Optional) */}
        {!isClinicDefault && pickedTemplate && pickedTemplate.breakDurationMinutes > 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--paper)] p-3">
            <button
              type="button"
              onClick={() => setShowBreakOverride(!showBreakOverride)}
              className="flex w-full items-center justify-between text-xs font-medium text-[var(--ink)]"
            >
              <span>Custom break start time (optional)</span>
              <span className="text-xs text-[var(--teal)]">
                {showBreakOverride ? 'Cancel override' : '+ Override default break'}
              </span>
            </button>
            {showBreakOverride && (
              <div className="mt-3 space-y-2">
                <Field
                  label={`Break Start (shift is ${formatRange12h(
                    pickedTemplate.startMinute,
                    pickedTemplate.endMinute
                  )}, length: ${pickedTemplate.breakDurationMinutes}m)`}
                >
                  <input
                    type="time"
                    className={inputCls}
                    value={
                      breakStartOverride ||
                      (pickedTemplate.defaultBreakStartMinute
                        ? minutesToTimeInput(pickedTemplate.defaultBreakStartMinute)
                        : '')
                    }
                    onChange={(e) => setBreakStartOverride(e.target.value)}
                  />
                </Field>
                {breakOverrideError && (
                  <p className="text-xs text-[var(--rust)]">{breakOverrideError}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* 5. Live Preview Feedback */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper)] p-3.5 space-y-1.5 text-xs text-[var(--ink)]">
          <p className="font-semibold text-[var(--teal)] flex items-center gap-1.5">
            <span>ℹ️</span> {preview.workingTime}
          </p>
          {preview.replaces.map((msg, i) => (
            <p key={`rep-${i}`} className="text-[var(--amber)] font-medium">
              • {msg}
            </p>
          ))}
          {preview.closesPending.map((msg, i) => (
            <p key={`close-${i}`} className="text-[var(--teal)]">
              • {msg}
            </p>
          ))}
        </div>

        <ErrorNote message={error} />

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
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
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
