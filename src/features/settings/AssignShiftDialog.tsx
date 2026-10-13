import { useMemo, useState } from 'react';
import { bookingService } from '@/services';
import { ErrorNote, Field, inputCls, btnPrimary, btnSecondary } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import {
  WEEKDAY_META,
  WEEKDAY_ORDER,
  formatRange12h,
  formatWeekdays,
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

import { SetWorkingHoursFlow } from './SetWorkingHoursFlow';

const CLINIC_DEFAULT_ID = '__clinic_default__';
export const CUSTOM_HOURS_ID = '__custom_hours__';

export type TherapistScheduleInfo = {
  type: 'template' | 'custom' | 'clinic_default';
  templateId: string | null;
  templateName: string | null;
  weekdays: number[];
  breakStartMinute: number | null;
  summary: string;
};

export function getTherapistScheduleInfo(
  therapistId: string,
  therapists: Therapist[],
  approvedAssignments: TherapistShiftAssignment[],
  templates: ShiftTemplate[],
  clinic: Clinic
): TherapistScheduleInfo {
  const therapist = therapists.find((t) => t.id === therapistId);
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const assignments = approvedAssignments.filter((a) => a.therapistId === therapistId);

  // 1. Check if assigned to shift templates
  const templateAssignments = assignments.filter((a) => a.shiftTemplateId);
  if (templateAssignments.length > 0) {
    const firstA = templateAssignments[0];
    const tmpl = templateById.get(firstA.shiftTemplateId!);
    const allWeekdays = sortWeekdays(
      Array.from(new Set(templateAssignments.flatMap((a) => a.weekdays ?? [])))
    );
    const dayLabel = allWeekdays.length > 0 ? formatWeekdays(allWeekdays) : 'No days';
    return {
      type: 'template',
      templateId: firstA.shiftTemplateId,
      templateName: tmpl?.name ?? 'Assigned Shift',
      weekdays: allWeekdays,
      breakStartMinute: firstA.breakStartMinute ?? null,
      summary: `${tmpl?.name ?? 'Shift'} (${dayLabel})`,
    };
  }

  // 2. Check if therapist has custom working hours
  const wh = therapist?.workingHours;
  if (wh && typeof wh === 'object') {
    const customDays = WEEKDAY_ORDER.filter((d) => {
      const k = String(d) as keyof typeof wh;
      return k in wh && (wh[k] ?? []).length > 0;
    });
    if (customDays.length > 0) {
      return {
        type: 'custom',
        templateId: null,
        templateName: 'Custom Hours',
        weekdays: customDays,
        breakStartMinute: null,
        summary: `Custom hours (${formatWeekdays(customDays)})`,
      };
    }
  }

  // 3. Clinic Default
  const closedDays = new Set(clinic.closedWeekdays ?? []);
  const openDays = WEEKDAY_ORDER.filter((d) => !closedDays.has(d));
  return {
    type: 'clinic_default',
    templateId: CLINIC_DEFAULT_ID,
    templateName: 'Clinic Default',
    weekdays: openDays,
    breakStartMinute: null,
    summary: 'Clinic Default',
  };
}

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

  // Check if there is an existing approved assignment for the clicked cell
  const matchingAssignment = useMemo(() => {
    if (!initialTherapistId || initialWeekday === null || initialWeekday === undefined) {
      return null;
    }
    return (
      approvedAssignments.find(
        (a) =>
          a.therapistId === initialTherapistId &&
          (a.weekdays ?? []).includes(initialWeekday)
      ) ?? null
    );
  }, [initialTherapistId, initialWeekday, approvedAssignments]);

  const [selectedTherapistIds, setSelectedTherapistIds] = useState<string[]>(() =>
    initialTherapistId ? [initialTherapistId] : []
  );
  const [selectedShiftId, setSelectedShiftId] = useState<string>(() => {
    if (
      matchingAssignment?.shiftTemplateId &&
      activeTemplates.some((t) => t.id === matchingAssignment.shiftTemplateId)
    ) {
      return matchingAssignment.shiftTemplateId;
    }
    if (initialTherapistId) {
      const currentSched = getTherapistScheduleInfo(
        initialTherapistId,
        activeTherapists,
        approvedAssignments,
        activeTemplates,
        clinic
      );
      if (
        currentSched.type === 'template' &&
        currentSched.templateId &&
        activeTemplates.some((t) => t.id === currentSched.templateId)
      ) {
        return currentSched.templateId;
      }
    }
    return activeTemplates.length > 0 ? activeTemplates[0].id : CLINIC_DEFAULT_ID;
  });
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(() => {
    if (matchingAssignment?.weekdays && matchingAssignment.weekdays.length > 0) {
      return [...matchingAssignment.weekdays];
    }
    if (initialTherapistId) {
      const currentSched = getTherapistScheduleInfo(
        initialTherapistId,
        activeTherapists,
        approvedAssignments,
        activeTemplates,
        clinic
      );
      if (
        (currentSched.type === 'template' || currentSched.type === 'custom') &&
        currentSched.weekdays.length > 0
      ) {
        if (initialWeekday !== null && initialWeekday !== undefined) {
          return sortWeekdays(
            Array.from(new Set([...currentSched.weekdays, initialWeekday]))
          );
        }
        return [...currentSched.weekdays];
      }
      return initialWeekday !== null && initialWeekday !== undefined
        ? [initialWeekday]
        : [1, 2, 3, 4, 5];
    }
    return initialWeekday !== null && initialWeekday !== undefined
      ? [initialWeekday]
      : [1, 2, 3, 4, 5];
  });
  const [breakStartOverride, setBreakStartOverride] = useState(() => {
    if (matchingAssignment?.breakStartMinute != null) {
      return minutesToTimeInput(matchingAssignment.breakStartMinute);
    }
    if (initialTherapistId) {
      const currentSched = getTherapistScheduleInfo(
        initialTherapistId,
        activeTherapists,
        approvedAssignments,
        activeTemplates,
        clinic
      );
      if (currentSched.breakStartMinute != null) {
        return minutesToTimeInput(currentSched.breakStartMinute);
      }
    }
    return '';
  });
  const [showBreakOverride, setShowBreakOverride] = useState(() => {
    if (matchingAssignment?.breakStartMinute != null) return true;
    if (initialTherapistId) {
      const currentSched = getTherapistScheduleInfo(
        initialTherapistId,
        activeTherapists,
        approvedAssignments,
        activeTemplates,
        clinic
      );
      return currentSched.breakStartMinute != null;
    }
    return false;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClinicDefault = selectedShiftId === CLINIC_DEFAULT_ID;
  const isCustomHours = selectedShiftId === CUSTOM_HOURS_ID;
  const pickedTemplate = activeTemplates.find((t) => t.id === selectedShiftId) ?? null;

  // Selected therapist objects
  const pickedTherapists = activeTherapists.filter((t) =>
    selectedTherapistIds.includes(t.id)
  );

  const singleTherapistId =
    selectedTherapistIds.length === 1 ? selectedTherapistIds[0] : null;
  const selectedTherapist = singleTherapistId
    ? activeTherapists.find((t) => t.id === singleTherapistId) ?? null
    : null;
  const [showCustomHoursFlow, setShowCustomHoursFlow] = useState(false);

  const singleSelectedTherapist = useMemo(
    () => activeTherapists.find((t) => t.id === singleTherapistId) ?? null,
    [activeTherapists, singleTherapistId]
  );

  const selectedTherapistSchedule = useMemo(() => {
    if (!singleTherapistId) return null;
    return getTherapistScheduleInfo(
      singleTherapistId,
      activeTherapists,
      approvedAssignments,
      activeTemplates,
      clinic
    );
  }, [singleTherapistId, activeTherapists, approvedAssignments, activeTemplates, clinic]);

  const currentWeekdays = useMemo(
    () => selectedTherapistSchedule?.weekdays ?? [],
    [selectedTherapistSchedule]
  );

  const addedDays = useMemo(
    () => selectedWeekdays.filter((d) => !currentWeekdays.includes(d)),
    [selectedWeekdays, currentWeekdays]
  );

  const removedDays = useMemo(
    () => currentWeekdays.filter((d) => !selectedWeekdays.includes(d)),
    [selectedWeekdays, currentWeekdays]
  );

  const isDaysUnchanged = useMemo(
    () =>
      currentWeekdays.length > 0 &&
      addedDays.length === 0 &&
      removedDays.length === 0,
    [currentWeekdays.length, addedDays.length, removedDays.length]
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

  // Toggle therapist selection and dynamically load schedule if single member picked
  function toggleTherapist(id: string) {
    const nextIds = selectedTherapistIds.includes(id)
      ? selectedTherapistIds.filter((x) => x !== id)
      : [...selectedTherapistIds, id];

    setSelectedTherapistIds(nextIds);

    // If exactly one therapist is now selected, dynamically load their current schedule
    if (nextIds.length === 1) {
      const sched = getTherapistScheduleInfo(
        nextIds[0],
        activeTherapists,
        approvedAssignments,
        activeTemplates,
        clinic
      );

      if (sched.type === 'template' && sched.templateId) {
        setSelectedShiftId(sched.templateId);
        if (sched.weekdays.length > 0) {
          setSelectedWeekdays(sched.weekdays);
        }
        if (sched.breakStartMinute != null) {
          setBreakStartOverride(minutesToTimeInput(sched.breakStartMinute));
          setShowBreakOverride(true);
        } else {
          setBreakStartOverride('');
          setShowBreakOverride(false);
        }
      } else if (sched.type === 'custom') {
        if (sched.weekdays.length > 0) {
          setSelectedWeekdays(sched.weekdays);
        }
        setBreakStartOverride('');
        setShowBreakOverride(false);
      } else if (sched.type === 'clinic_default') {
        setSelectedShiftId(CLINIC_DEFAULT_ID);
        setSelectedWeekdays(sched.weekdays);
        setBreakStartOverride('');
        setShowBreakOverride(false);
      }
    }
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

  if (!isOpen) return null;

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
              const sched = getTherapistScheduleInfo(
                t.id,
                activeTherapists,
                approvedAssignments,
                activeTemplates,
                clinic
              );
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTherapist(t.id)}
                  className={`inline-flex flex-col items-start gap-0.5 rounded-xl px-3 py-1.5 text-xs font-medium transition text-left ${
                    isSelected
                      ? 'bg-[var(--teal)] text-white shadow-xs'
                      : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--paper)]'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: isSelected ? 'white' : t.color ?? '#2c5f63' }}
                      aria-hidden
                    />
                    <span className="font-semibold">{t.name}</span>
                  </div>
                  <span
                    className={`text-[10px] ${
                      isSelected ? 'text-white/80' : 'text-[var(--muted)]'
                    }`}
                  >
                    {sched.summary}
                  </span>
                </button>
              );
            })}
          </div>
          {selectedTherapistIds.length === 0 && (
            <p className="text-[11px] text-[var(--rust)]">Please select at least one therapist.</p>
          )}

          {/* Current schedule context banner when 1 therapist is selected */}
          {singleSelectedTherapist && selectedTherapistSchedule && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper)] p-3.5 text-xs space-y-1.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-[var(--ink)] flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: singleSelectedTherapist.color ?? '#2c5f63' }}
                    aria-hidden
                  />
                  Current Schedule: {singleSelectedTherapist.name}
                </span>
                <span className="rounded-full bg-[var(--teal-light)] px-2.5 py-0.5 text-[10.5px] font-bold text-[var(--teal)]">
                  {selectedTherapistSchedule.summary}
                </span>
              </div>

              {/* Day-specific status if opened by clicking a cell */}
              {initialWeekday !== null && initialWeekday !== undefined && (
                <div className="text-xs text-[var(--ink)] pt-0.5">
                  <span className="font-medium text-[var(--muted)]">
                    {WEEKDAY_META[initialWeekday]?.full}:
                  </span>{' '}
                  {matchingAssignment ? (
                    <span className="font-semibold text-[var(--teal)]">
                      Currently assigned to {selectedTherapistSchedule.templateName}
                    </span>
                  ) : (
                    <span className="font-semibold text-[var(--amber-strong)]">
                      Currently a Day Off (No shift scheduled)
                    </span>
                  )}
                </div>
              )}

              {/* Weekly active days summary */}
              {selectedTherapistSchedule.type === 'template' && (
                <div className="space-y-0.5 text-[11px] pt-0.5">
                  <p className="text-[var(--muted)]">
                    Active working days:{' '}
                    <span className="font-medium text-[var(--ink)]">
                      {selectedTherapistSchedule.weekdays.length > 0
                        ? formatWeekdays(selectedTherapistSchedule.weekdays)
                        : 'None'}
                    </span>
                    {addedDays.length > 0 && (
                      <span className="text-[var(--teal)] font-medium">
                        {' '}• Adding {formatWeekdays(addedDays)} to active days below.
                      </span>
                    )}
                    {removedDays.length > 0 && (
                      <span className="text-[var(--rust)] font-medium">
                        {' '}• Removing {formatWeekdays(removedDays)} from schedule.
                      </span>
                    )}
                    {isDaysUnchanged && (
                      <span> • Schedule unchanged.</span>
                    )}
                  </p>
                </div>
              )}

              {selectedTherapistSchedule.type === 'custom' && (
                <p className="text-[11px] text-[var(--muted)]">
                  Currently on custom working hours ({formatWeekdays(selectedTherapistSchedule.weekdays)}). Selecting a shift template below will supersede custom hours on the chosen days.
                </p>
              )}
            </div>
          )}

          {/* Schedule comparison summary when multiple team members are selected */}
          {selectedTherapistIds.length > 1 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--paper)] p-2.5 text-xs text-[var(--ink)] space-y-1">
              <p className="font-medium text-[var(--ink)]">
                Assigning shift to {selectedTherapistIds.length} team members:
              </p>
              <ul className="space-y-0.5 text-[11px]">
                {pickedTherapists.map((t) => {
                  const sched = getTherapistScheduleInfo(
                    t.id,
                    activeTherapists,
                    approvedAssignments,
                    activeTemplates,
                    clinic
                  );
                  return (
                    <li key={t.id} className="flex items-center gap-1.5 text-[var(--muted)]">
                      <span className="font-medium text-[var(--ink)]">{t.name}:</span>
                      <span>currently {sched.summary}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[10.5px] text-[var(--muted)] pt-0.5">
                The shift template and weekdays chosen below will be applied to all selected members.
              </p>
            </div>
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
            onChange={(e) => {
              const newId = e.target.value;
              setSelectedShiftId(newId);
              const nextTemplate = activeTemplates.find((t) => t.id === newId);
              if (showBreakOverride && nextTemplate?.defaultBreakStartMinute) {
                setBreakStartOverride(minutesToTimeInput(nextTemplate.defaultBreakStartMinute));
              }
            }}
          >
            <option value={CLINIC_DEFAULT_ID}>
              🏢 Clinic Default Hours ({formatRange12h(clinicStart, clinicEnd)})
            </option>
            <option
              value={CUSTOM_HOURS_ID}
              disabled={selectedTherapistIds.length !== 1}
            >
              {selectedTherapistIds.length === 1
                ? 'Custom hours (individual)'
                : 'Custom hours (select one person)'}
            </option>
            {activeTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({formatRange12h(t.startMinute, t.endMinute)}
                {t.breakDurationMinutes > 0 ? `, ${t.breakDurationMinutes}m break` : ''})
              </option>
            ))}
          </select>
        </div>

        {/* 3. Working Days Selection (Only when not resetting to clinic default or custom hours) */}
        {!isClinicDefault && !isCustomHours && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Active Weekdays
              </label>
              {/* Presets */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {initialWeekday !== null && initialWeekday !== undefined && selectedTherapistSchedule && selectedTherapistSchedule.weekdays.length > 0 && !selectedTherapistSchedule.weekdays.includes(initialWeekday) && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedWeekdays(
                          sortWeekdays(
                            Array.from(
                              new Set([...selectedTherapistSchedule.weekdays, initialWeekday])
                            )
                          )
                        )
                      }
                      className="rounded px-2 py-0.5 font-medium text-[var(--teal)] hover:bg-[var(--teal-light)]/40"
                    >
                      + Add {WEEKDAY_META[initialWeekday]?.short}
                    </button>
                    <span className="text-[var(--border)]">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedWeekdays([initialWeekday])}
                      className="rounded px-2 py-0.5 font-medium text-[var(--teal)] hover:bg-[var(--teal-light)]/40"
                    >
                      {WEEKDAY_META[initialWeekday]?.short} only
                    </button>
                    <span className="text-[var(--border)]">|</span>
                  </>
                )}
                {selectedTherapistSchedule && selectedTherapistSchedule.weekdays.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectedWeekdays(selectedTherapistSchedule.weekdays)}
                      className="rounded px-2 py-0.5 font-medium text-[var(--teal)] hover:bg-[var(--teal-light)]/40"
                    >
                      Existing only
                    </button>
                    <span className="text-[var(--border)]">|</span>
                  </>
                )}
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
                <span className="text-[var(--border)]">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedWeekdays([])}
                  className="rounded px-2 py-0.5 font-medium text-[var(--muted)] hover:bg-[var(--paper)]"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAY_ORDER.map((day) => {
                const isSelected = selectedWeekdays.includes(day);
                const isClosed = closedDays.has(day);
                const wasScheduled = currentWeekdays.includes(day);

                let badgeText: string | null = null;
                let badgeClass = '';

                if (isClosed) {
                  badgeText = 'Closed';
                  badgeClass = isSelected ? 'text-white/80' : 'text-[var(--muted)]';
                } else if (isSelected && !wasScheduled) {
                  badgeText = '+Add';
                  badgeClass = 'text-white font-semibold';
                } else if (isSelected && wasScheduled) {
                  badgeText = 'Active';
                  badgeClass = 'text-white/80';
                } else if (!isSelected && wasScheduled) {
                  badgeText = '−Removed';
                  badgeClass = 'text-[var(--rust)] font-semibold';
                }

                const buttonStyle = isSelected
                  ? 'bg-[var(--teal)] text-white shadow-sm ring-1 ring-[var(--teal)]'
                  : !isSelected && wasScheduled
                  ? 'border border-[var(--rust)]/40 bg-[var(--rust-light)]/20 text-[var(--ink)] hover:bg-[var(--rust-light)]/40'
                  : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--paper)]';

                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleWeekday(day)}
                    className={`flex flex-col items-center justify-center rounded-xl py-2 text-center transition min-h-[52px] ${buttonStyle}`}
                  >
                    <span className="text-xs font-bold">{WEEKDAY_META[day]?.short}</span>
                    {badgeText && (
                      <span className={`text-[9px] ${badgeClass}`}>{badgeText}</span>
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
        {!isClinicDefault && !isCustomHours && pickedTemplate && pickedTemplate.breakDurationMinutes > 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--paper)] p-3">
            <button
              type="button"
              onClick={() => {
                const nextShow = !showBreakOverride;
                setShowBreakOverride(nextShow);
                if (nextShow && pickedTemplate) {
                  if (!breakStartOverride && pickedTemplate.defaultBreakStartMinute) {
                    setBreakStartOverride(minutesToTimeInput(pickedTemplate.defaultBreakStartMinute));
                  }
                } else if (!nextShow) {
                  setBreakStartOverride('');
                }
              }}
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
                    value={breakStartOverride}
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

        {/* 5. Live Preview Feedback / Custom Hours Notice */}
        {isCustomHours ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper)] p-3.5 space-y-1.5 text-xs text-[var(--ink)]">
            <p className="font-medium text-[var(--amber-strong)]">
              Custom hours replace all assigned shifts for {selectedTherapist?.name ?? 'selected member'}.
            </p>
          </div>
        ) : (
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
        )}

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
          {isCustomHours ? (
            <button
              type="button"
              className={btnPrimary}
              onClick={() => setShowCustomHoursFlow(true)}
              disabled={!selectedTherapist}
            >
              Set custom hours…
            </button>
          ) : (
            <button
              type="button"
              className={btnPrimary}
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              {submitLabel}
            </button>
          )}
        </div>
      </div>

      {showCustomHoursFlow && selectedTherapist && (
        <SetWorkingHoursFlow
          open={showCustomHoursFlow}
          therapist={selectedTherapist}
          onClose={() => setShowCustomHoursFlow(false)}
          onSaved={() => {
            setShowCustomHoursFlow(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}
