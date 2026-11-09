import { useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { clinicDepartments, DEPARTMENT_LABELS } from '@/domain/departments';
import { departmentHours } from '@/domain/departmentHours';
import type { Clinic, DepartmentHoursOverride } from '@/domain/types';
import { Field, InfoTip, inputCls, SectionCard } from '@/components/ui';
import { SectionSaveBar, useClinicSectionForm } from './settingsShared';
import { OpenDaysStrip } from './OpenDaysStrip';

export function cleanDepartmentHours(
  raw: Partial<Record<'home' | 'ward', DepartmentHoursOverride>> | null | undefined
): Partial<Record<'home' | 'ward', DepartmentHoursOverride>> | null {
  if (!raw) return null;
  const result: Partial<Record<'home' | 'ward', DepartmentHoursOverride>> = {};
  for (const dept of ['home', 'ward'] as const) {
    const o = raw[dept];
    if (!o) continue;
    const cleaned: DepartmentHoursOverride = {};
    if (typeof o.startHour === 'number' && Number.isInteger(o.startHour) && o.startHour >= 0 && o.startHour <= 23) {
      cleaned.startHour = o.startHour;
    }
    if (typeof o.endHour === 'number' && Number.isInteger(o.endHour) && o.endHour >= 1 && o.endHour <= 24) {
      cleaned.endHour = o.endHour;
    }
    if (Array.isArray(o.closedWeekdays)) {
      cleaned.closedWeekdays = o.closedWeekdays;
    }
    if (typeof o.slotMinutes === 'number' && o.slotMinutes > 0) {
      cleaned.slotMinutes = o.slotMinutes;
    }
    if (typeof o.startStepMinutes === 'number' && o.startStepMinutes > 0) {
      cleaned.startStepMinutes = o.startStepMinutes;
    }
    if (o.operating !== undefined) {
      cleaned.operating = o.operating;
    }
    if (Object.keys(cleaned).length > 0) {
      result[dept] = cleaned;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

const HOURS = Array.from({ length: 25 }, (_, i) => i);
const SLOT_OPTIONS = [15, 20, 30, 45, 60, 90, 120];
const STEP_OPTIONS = [5, 10, 15, 30, 60];

function formatHourLabel(h: number): string {
  if (h === 0 || h === 24) return `${h}:00 (12:00 AM)`;
  if (h === 12) return '12:00 (12:00 PM)';
  if (h < 12) return `${h}:00 (${h}:00 AM)`;
  return `${h}:00 (${h - 12}:00 PM)`;
}

export function DepartmentHoursSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const clinic = useClinic();
  const depts = clinicDepartments(clinic);
  const nonClinicDepts = depts.filter((d): d is 'home' | 'ward' => d !== 'clinic');

  const { form, set, save, cancel, dirty, saved, busy, error, setError, showSaveBar } =
    useClinicSectionForm<{ departmentHours?: Partial<Record<'home' | 'ward', DepartmentHoursOverride>> | null }>(
      (c: Clinic) => ({
        departmentHours: cleanDepartmentHours(c.departmentHours),
      }),
      onDirtyChange
    );

  const [hoursProblem, setHoursProblem] = useState<string | null>(null);

  if (depts.length <= 1) return null;

  const opHours = departmentHours(clinic, 'clinic');

  function updateDept(dept: 'home' | 'ward', patch: Partial<DepartmentHoursOverride>) {
    const current = form.departmentHours?.[dept] ?? {};
    const updated: DepartmentHoursOverride = { ...current, ...patch };
    // Remove undefined keys
    for (const key of Object.keys(updated) as (keyof DepartmentHoursOverride)[]) {
      if (updated[key] === undefined) {
        delete updated[key];
      }
    }
    const next = {
      ...form.departmentHours,
      [dept]: updated,
    };
    set({ departmentHours: cleanDepartmentHours(next) });
  }

  async function handleSave() {
    setHoursProblem(null);
    for (const d of nonClinicDepts) {
      const o = form.departmentHours?.[d];
      if (!o) continue;
      const s = o.startHour ?? opHours.clinicHours.startHour;
      const e = o.endHour ?? opHours.clinicHours.endHour;
      if (e <= s) {
        const msg = `End time must be after start time for ${DEPARTMENT_LABELS[d]}.`;
        setError(msg);
        setHoursProblem(msg);
        return;
      }
    }
    await save();
  }

  return (
    <div>
      <SectionCard
        id="settings-card-department-hours"
        title="Hours by department"
        subtitle="Set separate booking hours, open days and slot lengths for Home care and Inpatients. Any field left as 'Same as OP' follows your clinic opening hours."
      >
        <fieldset disabled={busy} className="space-y-6">
          {nonClinicDepts.map((d, index) => {
            const override = form.departmentHours?.[d] ?? {};
            const isCustomDays = Array.isArray(override.closedWeekdays);
            const deptLabel = DEPARTMENT_LABELS[d];

            return (
              <div
                key={d}
                className={index > 0 ? 'border-t border-[var(--border)] pt-6' : ''}
                data-testid={`department-hours-${d}`}
              >
                <div className="mb-4">
                  <h3 className="font-display text-base font-semibold text-[var(--ink)]">{deptLabel}</h3>
                  <p className="text-xs text-[var(--muted)]">Booking hours and appointment slots for {deptLabel}.</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label={
                      <>
                        Start time
                        <InfoTip text={`First bookable slot of the day for ${deptLabel}.`} />
                      </>
                    }
                  >
                    <select
                      className={inputCls}
                      aria-label={`${deptLabel} Start time`}
                      value={override.startHour !== undefined ? String(override.startHour) : ''}
                      onChange={(e) =>
                        updateDept(d, {
                          startHour: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    >
                      <option value="">Same as OP ({formatHourLabel(opHours.clinicHours.startHour)})</option>
                      {HOURS.slice(0, 24).map((h) => (
                        <option key={h} value={h}>
                          {formatHourLabel(h)}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label={
                      <>
                        End time
                        <InfoTip text={`Last slot end time for ${deptLabel}.`} />
                      </>
                    }
                  >
                    <select
                      className={inputCls}
                      aria-label={`${deptLabel} End time`}
                      value={override.endHour !== undefined ? String(override.endHour) : ''}
                      onChange={(e) =>
                        updateDept(d, {
                          endHour: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    >
                      <option value="">Same as OP ({formatHourLabel(opHours.clinicHours.endHour)})</option>
                      {HOURS.slice(1).map((h) => (
                        <option key={h} value={h}>
                          {formatHourLabel(h)}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <div className="sm:col-span-2">
                    <Field
                      label={
                        <>
                          Open days
                          <InfoTip text={`Which days ${deptLabel} is open every week.`} />
                        </>
                      }
                    >
                      <select
                        className={inputCls}
                        aria-label={`${deptLabel} Open days`}
                        value={isCustomDays ? 'custom' : 'same'}
                        onChange={(e) => {
                          if (e.target.value === 'same') {
                            updateDept(d, { closedWeekdays: undefined });
                          } else {
                            updateDept(d, { closedWeekdays: [...opHours.closedWeekdays] });
                          }
                        }}
                      >
                        <option value="same">Same as OP</option>
                        <option value="custom">Custom open days</option>
                      </select>
                    </Field>

                    {isCustomDays && (
                      <div className="mt-2" data-testid={`open-days-strip-${d}`}>
                        <OpenDaysStrip
                          closedWeekdays={override.closedWeekdays ?? opHours.closedWeekdays}
                          disabled={busy}
                          onChange={(closedWeekdays) => updateDept(d, { closedWeekdays })}
                        />
                      </div>
                    )}
                  </div>

                  <Field
                    label={
                      <>
                        Appointment length
                        <InfoTip text={`The length of a standard appointment for ${deptLabel}.`} />
                      </>
                    }
                  >
                    <select
                      className={inputCls}
                      aria-label={`${deptLabel} Appointment length`}
                      value={override.slotMinutes !== undefined ? String(override.slotMinutes) : ''}
                      onChange={(e) =>
                        updateDept(d, {
                          slotMinutes: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    >
                      <option value="">Same as OP ({opHours.slotMinutes} minutes)</option>
                      {SLOT_OPTIONS.map((mins) => (
                        <option key={mins} value={mins}>
                          {mins} minutes
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label={
                      <>
                        Start step
                        <InfoTip text={`Calendar grid slot start interval for ${deptLabel}.`} />
                      </>
                    }
                  >
                    <select
                      className={inputCls}
                      aria-label={`${deptLabel} Start step`}
                      value={override.startStepMinutes !== undefined ? String(override.startStepMinutes) : ''}
                      onChange={(e) =>
                        updateDept(d, {
                          startStepMinutes: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    >
                      <option value="">Same as OP ({opHours.startStepMinutes} minutes)</option>
                      {STEP_OPTIONS.map((mins) => (
                        <option key={mins} value={mins}>
                          Every {mins} minutes
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            );
          })}
        </fieldset>

        {showSaveBar && (
          <SectionSaveBar
            dirty={dirty}
            saved={saved}
            busy={busy}
            onSave={() => void handleSave()}
            onCancel={() => {
              cancel();
              setHoursProblem(null);
            }}
            error={error || hoursProblem}
          />
        )}
      </SectionCard>
    </div>
  );
}
